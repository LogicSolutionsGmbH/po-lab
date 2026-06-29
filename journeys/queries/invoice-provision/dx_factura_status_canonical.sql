/* ============================================================================
 * CANONICAL DIAGNOSTIC · "what happened to this factura extraída?"  (TEXT REPORT)
 * ----------------------------------------------------------------------------
 * COMPOSED query (NOT a verbatim app query) — every join/column/status code is
 * taken from verified worker + journeys sources:
 *   - extraction JSON keys ........ tag.provision.with.invoice.workflow.ts:30-53
 *   - booking resolution (6x, full  resolve.booking.from.extracted.data.helper.ts
 *     cross-lookup union) ..........   :70-204  (every signal tried vs every resolver)
 *   - status semantics ............ invoices.provision-state.ts:7-12
 *   - booking-cost / context ...... provision.matched-preview.data.ts:185-269
 *   - booked-invoice (FPRO) ....... invoice-already-exist.data.ts / invoice.already.booked.helper.ts
 *
 * Emits ONE text message (many bookings/provisions read better as prose than a grid).
 * Tip: SSMS "Results to Text" (Ctrl+T) renders the newlines. Requires STRING_AGG (SQL2017+).
 *
 * INPUTS (set @cd_identityTenant + ONE selector; document name is the best case):
 *   @cd_identityTenant       REQUIRED
 *   @documentName            ActivoDigital.tx_nombreArchivo  (preferred)
 *   @cd_identityBookingCosto alternate selector
 *   @cd_identityFacturaExtraida alternate selector
 *
 * Country-agnostic: FPRO tables resolved at runtime via spp_ObtieneTablaPorPais.
 *
 * COLLATION: this tenant DB's default is SQL_Latin1_General_CP1_CI_AS but data columns
 * are Modern_Spanish_CI_AS. Temp-table string columns + the real columns they're compared
 * against are both "implicit" collation, so a mismatch errors (Msg 468). We force both
 * sides to COLLATE DATABASE_DEFAULT on each temp-vs-column comparison; equality on ASCII
 * shipping refs/containers/MBL/MAWB is identical under either collation.
 * ============================================================================ */
SET NOCOUNT ON;

DECLARE @cd_identityTenant          INT           = 11;  -- REQUIRED
DECLARE @documentName               NVARCHAR(400) = NULL;  -- preferred selector
DECLARE @cd_identityBookingCosto    BIGINT        = NULL;  -- alt selector
DECLARE @cd_identityFacturaExtraida BIGINT        = 11780;  -- alt selector

DECLARE @nl NCHAR(2) = NCHAR(13) + NCHAR(10);
DECLARE @report NVARCHAR(MAX) = N'';

/* ---- (A) Resolve the target factura extraída from whichever selector was given ---- */
IF @cd_identityFacturaExtraida IS NULL AND @documentName IS NOT NULL
  SELECT TOP (1) @cd_identityFacturaExtraida = f.cd_identityFacturaExtraida
  FROM dbo.TESch_FacturaExtraida f
  INNER JOIN dbo.TESch_ActivoDigital a ON a.cd_identityActivoDigital = f.cd_identityActivoDigital
  WHERE f.cd_identityTenant = @cd_identityTenant
    AND a.tx_nombreArchivo = @documentName        -- exact; use LIKE @documentName+'%' if needed
  ORDER BY f.fh_creacion DESC;                     -- doc names can repeat -> newest wins

IF @cd_identityFacturaExtraida IS NULL AND @cd_identityBookingCosto IS NOT NULL
  SELECT TOP (1) @cd_identityFacturaExtraida = fec.cd_identityFacturaExtraida
  FROM dbo.TESch_FacturaExtraidaContabilizada fec
  INNER JOIN dbo.TESch_FacturaExtraida f ON f.cd_identityFacturaExtraida = fec.cd_identityFacturaExtraida
  WHERE f.cd_identityTenant = @cd_identityTenant
    AND fec.cd_identityBookingCosto = @cd_identityBookingCosto;

IF @cd_identityFacturaExtraida IS NULL
  THROW 50010, 'No factura extraída resolved for the given tenant + selector.', 1;

/* ---- (B) Header fields ---- */
DECLARE @docName NVARCHAR(400), @invNo NVARCHAR(200), @invDate DATETIME,
        @taxId NVARCHAR(100), @cur NVARCHAR(20),
        @sub DECIMAL(18,2), @imp DECIMAL(18,2), @tot DECIMAL(18,2),
        @extrStatus NVARCHAR(50), @json NVARCHAR(MAX), @ctryCode NVARCHAR(20);
SELECT
  @docName    = a.tx_nombreArchivo,
  @invNo      = cls.tx_numeroReferenciaDocumento,
  @invDate    = cls.fh_emision,
  @taxId      = f.tx_identificacionFiscalProveedor,
  @cur        = f.tx_moneda,
  @sub        = f.im_subtotal,
  @imp        = f.im_impuestoTotal,
  @tot        = f.im_total,
  @extrStatus = f.st_estatusExtraccion,
  @json       = f.tx_datosExtraccionCompletos
FROM dbo.TESch_FacturaExtraida f
INNER JOIN dbo.TESch_ActivoDigital a ON a.cd_identityActivoDigital = f.cd_identityActivoDigital
OUTER APPLY (
  SELECT TOP (1) c.tx_numeroReferenciaDocumento, c.fh_emision
  FROM dbo.TESch_ClasificacionActivoDigital c
  WHERE c.cd_identityActivoDigital = f.cd_identityActivoDigital
  ORDER BY c.cd_identityClasificacionActivoDigital DESC
) cls
WHERE f.cd_identityFacturaExtraida = @cd_identityFacturaExtraida;

IF @json IS NOT NULL AND ISJSON(@json) = 1
  SET @ctryCode = JSON_VALUE(@json, '$.country_code');

/* ---- (C) Parse the extracted reference signals (worker reads these JSON arrays) ---- */
CREATE TABLE #sig (
  sig_type NVARCHAR(40)  COLLATE DATABASE_DEFAULT,
  val      NVARCHAR(400) COLLATE DATABASE_DEFAULT  -- match tenant DB collation (e.g. Modern_Spanish_CI_AS)
);
IF @json IS NOT NULL AND ISJSON(@json) = 1
  INSERT INTO #sig (sig_type, val)
  SELECT s.sig_type, LTRIM(RTRIM(j.value))
  FROM (VALUES
    ('shipment_reference','$.shipment_reference'),
    ('container_numbers','$.container_numbers'),
    ('heroes_service_id','$.heroes_service_id'),
    ('mbl','$.mbl'), ('hbl','$.hbl'), ('bl','$.bl'), ('mawb','$.mawb')
  ) AS s(sig_type, path)
  CROSS APPLY OPENJSON(@json, s.path) j
  WHERE j.value IS NOT NULL AND LTRIM(RTRIM(j.value)) <> '';

/* ---- (D) Resolve cd_identityBooking from the references — full cross-lookup union.
 *          The worker tries every signal value against ALL 6 resolvers, so we pool all
 *          distinct values and run each resolver over the pool (identical union). ---- */
CREATE TABLE #bk (cd_identityBooking BIGINT, method NVARCHAR(40) COLLATE DATABASE_DEFAULT);

-- tx_referencia
INSERT INTO #bk SELECT DISTINCT bpi.cd_identityBooking, 'tx_referencia'
FROM dbo.TESch_BookingPartesInvolucradas bpi WITH (NOLOCK)
WHERE bpi.tx_referencia COLLATE DATABASE_DEFAULT IN (SELECT val FROM #sig) AND bpi.cd_identityBooking IS NOT NULL;
-- container / heroes service (uuid_servicio is uniqueidentifier -> only GUID-castable values)
INSERT INTO #bk SELECT DISTINCT dc.cd_identityViaje, 'container/service'
FROM dbo.TESch_DetalleCarga dc WITH (NOLOCK)
WHERE (dc.nu_contenedor COLLATE DATABASE_DEFAULT IN (SELECT val FROM #sig)
       OR dc.uuid_servicio IN (SELECT TRY_CONVERT(uniqueidentifier, val) FROM #sig
                               WHERE TRY_CONVERT(uniqueidentifier, val) IS NOT NULL))
  AND dc.cd_identityViaje IS NOT NULL;
-- MBL
INSERT INTO #bk SELECT DISTINCT m.cd_identityBooking, 'MBL'
FROM dbo.TESch_MBL m WITH (NOLOCK)
WHERE m.cd_masterMBL COLLATE DATABASE_DEFAULT IN (SELECT val FROM #sig) AND m.cd_identityBooking IS NOT NULL;
-- HBL
INSERT INTO #bk SELECT DISTINCT m.cd_identityBooking, 'HBL'
FROM dbo.TESch_BL m WITH (NOLOCK)
WHERE m.cd_houseBL COLLATE DATABASE_DEFAULT IN (SELECT val FROM #sig) AND m.cd_identityBooking IS NOT NULL;
-- BL / carrier reservation
INSERT INTO #bk SELECT DISTINCT tb.cd_identityBooking, 'BL/reserva'
FROM dbo.TESch_TramoBooking tb WITH (NOLOCK)
WHERE tb.tx_reservaTransportador COLLATE DATABASE_DEFAULT IN (SELECT val FROM #sig) AND tb.cd_identityBooking IS NOT NULL;
-- MAWB (normalized: strip dashes/spaces both sides)
INSERT INTO #bk SELECT DISTINCT h.cd_identityBooking, 'MAWB'
FROM dbo.TESch_Mawb m WITH (NOLOCK)
INNER JOIN dbo.TESch_Hawb h WITH (NOLOCK) ON h.cd_identityMawb = m.cd_identityMawb
WHERE REPLACE(REPLACE(m.cd_mawb,'-',''),' ','') COLLATE DATABASE_DEFAULT
      IN (SELECT REPLACE(REPLACE(val,'-',''),' ','') FROM #sig)
  AND h.cd_identityBooking IS NOT NULL;

/* ---- (E) Provision / contabilizada state (matched-preview parity; LEFT so all states show) ---- */
CREATE TABLE #prov (
  booking_cost_id BIGINT NULL, booking_id BIGINT NULL, amount DECIMAL(18,2) NULL,
  currency NVARCHAR(20) COLLATE DATABASE_DEFAULT NULL, concepto NVARCHAR(400) COLLATE DATABASE_DEFAULT NULL,
  vendor_name NVARCHAR(300) COLLATE DATABASE_DEFAULT NULL,
  vendor_directory_id BIGINT NULL, shipment_ref NVARCHAR(200) COLLATE DATABASE_DEFAULT NULL,
  responsible_country_id INT NULL, st_estatus INT NULL, estado NVARCHAR(40) COLLATE DATABASE_DEFAULT NULL,
  booked_factura BIGINT NULL, booked_nu NVARCHAR(100) COLLATE DATABASE_DEFAULT NULL, booked_issue DATETIME NULL,
  booked_user_id INT NULL, booked_user_name NVARCHAR(200) COLLATE DATABASE_DEFAULT NULL
);
INSERT INTO #prov (booking_cost_id, booking_id, amount, currency, concepto, vendor_name,
  vendor_directory_id, shipment_ref, responsible_country_id, st_estatus, estado)
SELECT
  bc.cd_identityBookingCosto, bc.cd_identityBooking, bc.im_importe, bc.tx_acronimoMoneda,
  COALESCE(NULLIF(LTRIM(RTRIM(cf.nb_conceptoFactura)), ''), bc.tx_conceptoCosto),
  dir.nb_nombreDirectorio, bc.cd_identityDirectorio, bpi.tx_referencia,
  bc.cd_identityPaisResponsable, fec.st_estatus,
  CASE
    WHEN fec.cd_identityBookingCosto IS NULL THEN 'unmatched'
    WHEN fec.st_estatus = 1 THEN 'booked'
    WHEN fec.st_estatus = 0 THEN 'matched'
    ELSE 'unknown'
  END
FROM dbo.TESch_FacturaExtraidaContabilizada fec
LEFT JOIN dbo.TESch_BookingCosto bc
  ON bc.cd_identityBookingCosto = fec.cd_identityBookingCosto AND bc.cd_identityTenant = @cd_identityTenant
LEFT JOIN dbo.TCSch_ConceptoFactura cf
  ON cf.cd_identityConceptoFactura = bc.cd_identityConceptoFactura AND cf.cd_identityTenant = @cd_identityTenant
LEFT JOIN dbo.TCSch_Directorio dir ON dir.cd_identityDirectorio = bc.cd_identityDirectorio
OUTER APPLY (
  SELECT TOP (1) ref.tx_referencia FROM dbo.TESch_BookingPartesInvolucradas ref
  WHERE ref.cd_identityBooking = bc.cd_identityBooking
    AND NULLIF(LTRIM(RTRIM(ref.tx_referencia)), '') IS NOT NULL
  ORDER BY ref.cd_identityBookingPartesInvolucradas DESC
) bpi
WHERE fec.cd_identityFacturaExtraida = @cd_identityFacturaExtraida;

/* ---- (F) For booked provisions, resolve the legacy invoice (dynamic FPRO, single country) ---- */
DECLARE @cd_identityPais INT = (SELECT MIN(responsible_country_id) FROM #prov WHERE booking_cost_id IS NOT NULL);
IF @cd_identityPais IS NOT NULL
BEGIN
  DECLARE @detailSuffix NVARCHAR(50), @headerSuffix NVARCHAR(50), @dd NVARCHAR(50);
  EXEC [dbo].[spp_ObtieneTablaPorPais] @cd_identityPais=@cd_identityPais,
    @dataType='tp_tablaFacturaCompraDetalle', @TableName=@detailSuffix OUTPUT, @DateFieldName=@dd OUTPUT;
  EXEC [dbo].[spp_ObtieneTablaPorPais] @cd_identityPais=@cd_identityPais,
    @dataType='tp_tablaFacturaCompra',        @TableName=@headerSuffix OUTPUT, @DateFieldName=@dd OUTPUT;
  DECLARE @detailTable SYSNAME = N'TESch_Factura'      + LTRIM(RTRIM(@detailSuffix));
  DECLARE @headerTable SYSNAME = N'TESch_Factura'      + LTRIM(RTRIM(@headerSuffix));
  DECLARE @fkColumn    SYSNAME = N'cd_identityFactura' + LTRIM(RTRIM(@headerSuffix));

  DECLARE @u NVARCHAR(MAX) = N'
    UPDATE p SET
      p.booked_factura   = vw.cd_identityFactura,
      p.booked_nu        = vw.nu_factura,
      p.booked_issue     = vw.fh_fechaEmision,
      p.booked_user_id   = hf.cd_identityUsuario,
      p.booked_user_name = bu.nb_nombre
    FROM #prov p
    INNER JOIN dbo.' + QUOTENAME(@detailTable) + N' fd WITH (NOLOCK)
      ON fd.cd_identityBookingCosto = p.booking_cost_id AND fd.cd_identityTenant = @p_tenant
    INNER JOIN dbo.' + QUOTENAME(@headerTable) + N' hf WITH (NOLOCK)
      ON hf.' + QUOTENAME(@fkColumn) + N' = fd.' + QUOTENAME(@fkColumn) + N'
     AND hf.st_cancelada <> ''S'' AND hf.st_estatus = ''A''
    INNER JOIN dbo.vw_FacturaMultiTenantGlobal vw
      ON vw.cd_identityFactura = hf.' + QUOTENAME(@fkColumn) + N' AND vw.cd_identityTenant = @p_tenant
    LEFT JOIN dbo.TCSch_Usuario bu ON bu.cd_identityUsuario = hf.cd_identityUsuario
    WHERE p.booking_cost_id IS NOT NULL;';
  EXEC sys.sp_executesql @u, N'@p_tenant INT', @p_tenant = @cd_identityTenant;
END

/* ---- (G) Build the text report ---- */
-- header
SET @report =
  N'=== FACTURA EXTRAÍDA #' + CAST(@cd_identityFacturaExtraida AS NVARCHAR(20))
  + N' (tenant ' + CAST(@cd_identityTenant AS NVARCHAR(20)) + N') ===' + @nl
  + N'Document:   ' + ISNULL(@docName,'(none)') + @nl
  + N'Invoice no: ' + ISNULL(@invNo,'(none)')
  + N'   Issued: ' + ISNULL(CONVERT(NVARCHAR(10), @invDate, 23), '(none)') + @nl
  + N'Vendor tax: ' + ISNULL(@taxId,'(none)')
  + N'   Amounts: ' + ISNULL(CONVERT(NVARCHAR(20),@sub),'?') + N' / ' + ISNULL(CONVERT(NVARCHAR(20),@imp),'?')
  + N' / ' + ISNULL(CONVERT(NVARCHAR(20),@tot),'?') + N' ' + ISNULL(@cur,'') + @nl
  + N'Extraction: ' + ISNULL(@extrStatus,'(none)')
  + N'   country_code: ' + ISNULL(@ctryCode,'(none)') + @nl;

-- references
DECLARE @refsText NVARCHAR(MAX);
SELECT @refsText = STRING_AGG(CONCAT('  ', sig_type, ': ', vals), @nl)
FROM (SELECT sig_type, STRING_AGG(val, ', ') AS vals FROM #sig GROUP BY sig_type) t;
SET @report += @nl + N'--- EXTRACTED REFERENCES ---' + @nl
  + ISNULL(@refsText, N'  (none extracted)') + @nl;

-- bookings resolved
DECLARE @bkText NVARCHAR(MAX), @bkCount INT = (SELECT COUNT(DISTINCT cd_identityBooking) FROM #bk);
SELECT @bkText = STRING_AGG(
    CONCAT('  booking ', CAST(cd_identityBooking AS NVARCHAR(20)),
           '  ref ', ISNULL(ref,'(none)'), '  [via ', methods, ']'), @nl)
FROM (
  SELECT b.cd_identityBooking, STRING_AGG(b.method, ', ') AS methods,
         (SELECT TOP (1) r.tx_referencia COLLATE DATABASE_DEFAULT FROM dbo.TESch_BookingPartesInvolucradas r
          WHERE r.cd_identityBooking = b.cd_identityBooking
            AND NULLIF(LTRIM(RTRIM(r.tx_referencia)),'') IS NOT NULL
          ORDER BY r.cd_identityBookingPartesInvolucradas DESC) AS ref
  FROM (SELECT DISTINCT cd_identityBooking, method FROM #bk) b
  GROUP BY b.cd_identityBooking
) g;
SET @report += @nl + N'--- BOOKINGS RESOLVED FROM REFERENCES (worker resolveBooking, full cross-lookup) ---' + @nl
  + N'  ' + CAST(@bkCount AS NVARCHAR(10)) + N' booking(s) found' + @nl
  + ISNULL(@bkText, N'  (no bookings matched the extracted references)') + @nl;

-- provisions / estado
DECLARE @provCount INT = (SELECT COUNT(*) FROM #prov);
DECLARE @overall NVARCHAR(40) =
  CASE
    WHEN @provCount = 0 THEN 'PENDING (worker not run / no contabilizada row)'
    WHEN EXISTS (SELECT 1 FROM #prov WHERE estado='booked')  THEN 'BOOKED'
    WHEN EXISTS (SELECT 1 FROM #prov WHERE estado='matched') THEN 'MATCHED'
    ELSE 'UNMATCHED (unresolved)'
  END;

DECLARE @provText NVARCHAR(MAX);
SELECT @provText = STRING_AGG(line, @nl) WITHIN GROUP (ORDER BY booking_cost_id) FROM (
  SELECT booking_cost_id,
    CONCAT(
      '  [', UPPER(estado), '] provision ', ISNULL(CAST(booking_cost_id AS NVARCHAR(20)),'(none)'),
      CASE WHEN booking_cost_id IS NULL THEN '' ELSE CONCAT(
        ': ', ISNULL(CONVERT(NVARCHAR(20),amount),'?'), ' ', ISNULL(currency,''),
        ', concepto "', ISNULL(concepto,'?'), '"',
        ', booking ', ISNULL(CAST(booking_id AS NVARCHAR(20)),'?'),
        ', shipment ', ISNULL(shipment_ref,'?'),
        ', vendor "', ISNULL(vendor_name,'?'), '"') END,
      CASE WHEN estado='booked' AND booked_factura IS NOT NULL
        THEN CONCAT(@nl, '       -> BOOKED to legacy invoice cd_identityFactura ',
                    CAST(booked_factura AS NVARCHAR(20)), ' (nu_factura ', ISNULL(booked_nu,'?'), ')',
                    ', issued ', ISNULL(CONVERT(NVARCHAR(10),booked_issue,23),'?'),
                    CASE WHEN booked_user_name IS NOT NULL THEN CONCAT(', by ', booked_user_name) ELSE '' END)
        WHEN estado='booked' AND booked_factura IS NULL
        THEN CONCAT(@nl, '       -> marked booked but no active legacy invoice row found (check country / st_cancelada)')
        ELSE '' END
    ) AS line
  FROM #prov
) x;
SET @report += @nl + N'--- PROVISION / CONTABILIZADA STATE ---' + @nl
  + N'  ESTADO: ' + @overall + @nl
  + ISNULL(@provText, N'  (no provision rows)') + @nl;

/* ---- (H) All BookingCosto rows for resolved bookings (sanity-check: are provisions even there?) ---- */
DECLARE @allProvText NVARCHAR(MAX), @allProvCount INT = 0;

IF (SELECT COUNT(DISTINCT cd_identityBooking) FROM #bk) > 0
BEGIN
  SELECT @allProvCount = COUNT(*)
  FROM dbo.TESch_BookingCosto bc WITH (NOLOCK)
  WHERE bc.cd_identityBooking IN (SELECT DISTINCT cd_identityBooking FROM #bk)
    AND bc.cd_identityTenant = @cd_identityTenant;

  SELECT @allProvText = STRING_AGG(line, @nl) WITHIN GROUP (ORDER BY bc_id)
  FROM (
    SELECT
      bc.cd_identityBookingCosto AS bc_id,
      CONCAT(
        '  bc#', CAST(bc.cd_identityBookingCosto AS NVARCHAR(20)),
        '  bk#', CAST(bc.cd_identityBooking AS NVARCHAR(20)),
        '  ', ISNULL(CONVERT(NVARCHAR(20), bc.im_importe),'?'), ' ', ISNULL(bc.tx_acronimoMoneda,''),
        '  concepto: "', ISNULL(COALESCE(NULLIF(LTRIM(RTRIM(cf.nb_conceptoFactura)),''), bc.tx_conceptoCosto),'?'), '"',
        '  cd_identityConceptoFactura: ', ISNULL(CAST(bc.cd_identityConceptoFactura AS NVARCHAR(20)),'?'),
        '  vendor: "', ISNULL(dir.nb_nombreDirectorio,'?'), '"',
        '  dir: ', ISNULL(CAST(bc.cd_identityDirectorio AS NVARCHAR(20)),'?'),
        '  dir_dir: ', ISNULL(CAST(bc.cd_identityDirectorioDireccion AS NVARCHAR(20)),'?'),
        '  st_estatus: ', ISNULL(CAST(bc.st_estatus AS NVARCHAR(10)),'?'),
        '  owner: "', ISNULL(own.nb_nombre, '(none)'), '"',
        '  fec_linked: ', ISNULL(
          (SELECT TOP 1 CONCAT(
            CASE WHEN fec2.st_estatus=1 THEN 'BOOKED' WHEN fec2.st_estatus=0 THEN 'MATCHED' ELSE 'st='+CAST(fec2.st_estatus AS NVARCHAR(5)) END,
            ' to fe#', CAST(fec2.cd_identityFacturaExtraida AS NVARCHAR(20)),
            CASE WHEN fec2.cd_identityFacturaExtraida = @cd_identityFacturaExtraida THEN ' <-- THIS INVOICE' ELSE '' END)
           FROM dbo.TESch_FacturaExtraidaContabilizada fec2 WITH (NOLOCK)
           WHERE fec2.cd_identityBookingCosto = bc.cd_identityBookingCosto
           ORDER BY fec2.st_estatus DESC),
          'free (no contabilizada row)')
      ) AS line
    FROM dbo.TESch_BookingCosto bc WITH (NOLOCK)
    LEFT JOIN dbo.TCSch_ConceptoFactura cf
      ON cf.cd_identityConceptoFactura = bc.cd_identityConceptoFactura AND cf.cd_identityTenant = @cd_identityTenant
    LEFT JOIN dbo.TCSch_Directorio dir ON dir.cd_identityDirectorio = bc.cd_identityDirectorio
    -- owner: party on the booking whose directory matches the provision's directory -> first assigned user
    OUTER APPLY (
      SELECT TOP (1) u.nb_nombre
      FROM dbo.TESch_BookingPartesInvolucradas bpi WITH (NOLOCK)
      INNER JOIN dbo.TESch_BookingPartesInvolucradasUsuarios bpiu WITH (NOLOCK)
        ON bpiu.cd_identityBookingPartesInvolucradas = bpi.cd_identityBookingPartesInvolucradas
      INNER JOIN dbo.TCSch_Usuario u WITH (NOLOCK)
        ON u.cd_identityUsuario = bpiu.cd_identityUsuario
      WHERE bpi.cd_identityBooking   = bc.cd_identityBooking
        AND bpi.cd_identityDirectorio = (SELECT cd_identityDirectorio FROM dbo.TCSch_DatosRFC WHERE cd_identityDatosRFC = @cd_identityTenant)
      ORDER BY bpiu.cd_identityBookingPartesInvolucradasUsuarios DESC
    ) own
    WHERE bc.cd_identityBooking IN (SELECT DISTINCT cd_identityBooking FROM #bk)
      AND bc.cd_identityTenant = @cd_identityTenant
  ) x;
END

SET @report += @nl + N'--- ALL BOOKINGCOSTO ROWS FOR RESOLVED BOOKING(S) ---' + @nl
  + N'  ' + CAST(@allProvCount AS NVARCHAR(10)) + N' provision(s) exist on the booking(s)' + @nl
  + ISNULL(@allProvText, N'  (no bookings resolved — nothing to look up)') + @nl;

/* ---- Print to Messages tab in 4 000-char chunks (PRINT/NVARCHAR limit) ---- */
DECLARE @_pos INT = 1, @_len INT = LEN(@report);
WHILE @_pos <= @_len
BEGIN
  PRINT SUBSTRING(@report, @_pos, 4000);
  SET @_pos += 4000;
END

DROP TABLE #sig; DROP TABLE #bk; DROP TABLE #prov;

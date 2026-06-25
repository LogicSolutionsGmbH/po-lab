/* ============================================================================
 * CANONICAL DIAGNOSTIC · "what happened to this factura extraída?"
 * ----------------------------------------------------------------------------
 * COMPOSED query (NOT a verbatim app query) — but every join/column/status code
 * below is taken from verified app sources:
 *   - status semantics .......... invoices.provision-state.ts:7-12
 *   - booking-cost/ctx block .... provision.matched-preview.data.ts:185-269
 *   - booked-invoice (FPRO) ..... invoice-already-exist.data.ts / invoice.already.booked.helper.ts
 *   - candidate/extraída fields .. fetch.unprocessed.invoices.ts, invoices.service.ts FACTURA_LIST_SELECT
 *
 * GOAL: from a small set of front-end params, return ONE row per provision link
 * telling you, for that factura extraída:
 *   - estado: pending / unmatched / matched / booked
 *   - if booked -> which legacy invoice (cd_identityFactura, nu_factura, date, by-user)
 *   - full context: shipment reference, booking, booking-cost amount, concepto,
 *     currency, vendor, responsible country.
 *
 * INPUTS (set @cd_identityTenant + ONE selector; document name is the best case):
 *   @cd_identityTenant       REQUIRED
 *   @documentName            ActivoDigital.tx_nombreArchivo  (preferred)
 *   @cd_identityBookingCosto alternate selector
 *   @cd_identityFacturaExtraida alternate selector
 *
 * Country-agnostic: the legacy FPRO tables are resolved at runtime via
 * spp_ObtieneTablaPorPais (no hardcoded country), same as w2/j2.
 * ============================================================================ */
SET NOCOUNT ON;

DECLARE @cd_identityTenant          INT          = NULL;   -- REQUIRED
DECLARE @documentName               NVARCHAR(400) = NULL;  -- preferred selector
DECLARE @cd_identityBookingCosto    BIGINT       = NULL;   -- alt selector
DECLARE @cd_identityFacturaExtraida BIGINT       = NULL;   -- alt selector

/* ---- (A) Resolve the target factura extraída from whichever selector was given ---- */
IF @cd_identityFacturaExtraida IS NULL AND @documentName IS NOT NULL
  SELECT TOP (1) @cd_identityFacturaExtraida = f.cd_identityFacturaExtraida
  FROM dbo.TESch_FacturaExtraida f
  INNER JOIN dbo.TESch_ActivoDigital a ON a.cd_identityActivoDigital = f.cd_identityActivoDigital
  WHERE f.cd_identityTenant = @cd_identityTenant
    AND a.tx_nombreArchivo = @documentName       -- exact; use LIKE @documentName+'%' if needed
  ORDER BY f.fh_creacion DESC;                    -- doc names can repeat -> newest wins

IF @cd_identityFacturaExtraida IS NULL AND @cd_identityBookingCosto IS NOT NULL
  SELECT TOP (1) @cd_identityFacturaExtraida = fec.cd_identityFacturaExtraida
  FROM dbo.TESch_FacturaExtraidaContabilizada fec
  INNER JOIN dbo.TESch_FacturaExtraida f ON f.cd_identityFacturaExtraida = fec.cd_identityFacturaExtraida
  WHERE f.cd_identityTenant = @cd_identityTenant
    AND fec.cd_identityBookingCosto = @cd_identityBookingCosto;

IF @cd_identityFacturaExtraida IS NULL
  THROW 50010, 'No factura extraída resolved for the given tenant + selector.', 1;

/* ---- (B) Resolve responsible country from this factura's provisions (for the FPRO tables).
 *          NULL when the invoice is unmatched/pending -> no booked-invoice join needed. ---- */
DECLARE @cd_identityPais INT = NULL;
SELECT @cd_identityPais = MIN(bc.cd_identityPaisResponsable)
FROM dbo.TESch_FacturaExtraidaContabilizada fec
INNER JOIN dbo.TESch_BookingCosto bc
  ON bc.cd_identityBookingCosto = fec.cd_identityBookingCosto
 AND bc.cd_identityTenant = @cd_identityTenant
WHERE fec.cd_identityFacturaExtraida = @cd_identityFacturaExtraida
  AND fec.cd_identityBookingCosto IS NOT NULL
  AND bc.cd_identityPaisResponsable IS NOT NULL;
-- Note: if provisions span >1 country, MIN picks one (app handles one country at a time).

/* ---- (C) Build the dynamic FPRO column list + joins (only when a country exists) ---- */
DECLARE @fproCols NVARCHAR(MAX) = N'
      CAST(NULL AS BIGINT)        AS booked_cd_identityFactura,
      CAST(NULL AS NVARCHAR(100)) AS booked_nu_factura,
      CAST(NULL AS DATETIME)      AS booked_issue_date,
      CAST(NULL AS INT)           AS booked_by_user_id,
      CAST(NULL AS NVARCHAR(200)) AS booked_by_user_name';
DECLARE @fproJoin NVARCHAR(MAX) = N'';

IF @cd_identityPais IS NOT NULL
BEGIN
  DECLARE @detailSuffix NVARCHAR(50), @headerSuffix NVARCHAR(50), @dummyDate NVARCHAR(50);
  EXEC [dbo].[spp_ObtieneTablaPorPais] @cd_identityPais=@cd_identityPais,
    @dataType='tp_tablaFacturaCompraDetalle', @TableName=@detailSuffix OUTPUT, @DateFieldName=@dummyDate OUTPUT;
  EXEC [dbo].[spp_ObtieneTablaPorPais] @cd_identityPais=@cd_identityPais,
    @dataType='tp_tablaFacturaCompra',        @TableName=@headerSuffix OUTPUT, @DateFieldName=@dummyDate OUTPUT;

  DECLARE @detailTable SYSNAME = N'TESch_Factura'      + LTRIM(RTRIM(@detailSuffix));
  DECLARE @headerTable SYSNAME = N'TESch_Factura'      + LTRIM(RTRIM(@headerSuffix));
  DECLARE @fkColumn    SYSNAME = N'cd_identityFactura' + LTRIM(RTRIM(@headerSuffix));

  SET @fproCols = N'
      vw.cd_identityFactura  AS booked_cd_identityFactura,
      vw.nu_factura          AS booked_nu_factura,
      vw.fh_fechaEmision     AS booked_issue_date,
      hf.cd_identityUsuario  AS booked_by_user_id,
      bu.nb_nombre           AS booked_by_user_name';

  SET @fproJoin = N'
    LEFT JOIN dbo.' + QUOTENAME(@detailTable) + N' fd WITH (NOLOCK)
      ON fd.cd_identityBookingCosto = bc.cd_identityBookingCosto
     AND fd.cd_identityTenant = @p_tenant
    LEFT JOIN dbo.' + QUOTENAME(@headerTable) + N' hf WITH (NOLOCK)
      ON hf.' + QUOTENAME(@fkColumn) + N' = fd.' + QUOTENAME(@fkColumn) + N'
     AND hf.st_cancelada <> ''S'' AND hf.st_estatus = ''A''
    LEFT JOIN dbo.vw_FacturaMultiTenantGlobal vw
      ON vw.cd_identityFactura = hf.' + QUOTENAME(@fkColumn) + N'
     AND vw.cd_identityTenant = @p_tenant
    LEFT JOIN dbo.TCSch_Usuario bu ON bu.cd_identityUsuario = hf.cd_identityUsuario';
END

/* ---- (D) The one canonical row-per-provision SELECT ---- */
DECLARE @sql NVARCHAR(MAX) = N'
SELECT
  f0.cd_identityFacturaExtraida,
  f0.cd_identityTenant,
  a.tx_nombreArchivo                 AS document_name,
  a.tx_rutaS3                        AS document_s3,
  cls.tx_numeroReferenciaDocumento   AS invoice_number,
  cls.fh_emision                     AS invoice_issue_date,
  f0.tx_identificacionFiscalProveedor AS vendor_tax_id,
  f0.tx_moneda                       AS extracted_currency,
  f0.im_subtotal, f0.im_impuestoTotal, f0.im_total,
  /* ---- estado (invoices.provision-state.ts) ---- */
  CASE
    WHEN fec.cd_identityFacturaExtraidaContabilizada IS NULL THEN ''pending (worker not run)''
    WHEN fec.cd_identityBookingCosto IS NULL                 THEN ''unmatched (unresolved)''
    WHEN fec.st_estatus = 1                                  THEN ''booked''
    WHEN fec.st_estatus = 0                                  THEN ''matched''
    ELSE ''unknown''
  END                                AS estado,
  fec.st_estatus                     AS contabilizada_st_estatus,
  fec.cd_identityFacturaExtraidaContabilizada AS contabilizada_id,
  /* ---- provision / booking-cost context (matched-preview parity) ---- */
  bc.cd_identityBookingCosto         AS booking_cost_id,
  bc.cd_identityBooking              AS booking_id,
  bpi.tx_referencia                  AS shipment_reference,
  bc.cd_identityDirectorio           AS vendor_directory_id,
  dir.nb_nombreDirectorio            AS vendor_name,
  COALESCE(NULLIF(LTRIM(RTRIM(cf.nb_conceptoFactura)), ''''), bc.tx_conceptoCosto) AS concepto,
  bc.im_importe                      AS provision_amount,
  bc.tx_acronimoMoneda               AS provision_currency,
  pm.cd_identityMoneda               AS provision_currency_id,
  bc.cd_identityPaisResponsable      AS responsible_country_id,
  ISNULL(bc.st_estatus, ''A'')       AS booking_cost_st_estatus,
  /* ---- if booked: which legacy invoice (dynamic FPRO) ---- */'
  + @fproCols + N'
FROM dbo.TESch_FacturaExtraida f0
INNER JOIN dbo.TESch_ActivoDigital a
  ON a.cd_identityActivoDigital = f0.cd_identityActivoDigital
LEFT JOIN dbo.TESch_ClasificacionActivoDigital cls
  ON cls.cd_identityActivoDigital = f0.cd_identityActivoDigital
LEFT JOIN dbo.TESch_FacturaExtraidaContabilizada fec
  ON fec.cd_identityFacturaExtraida = f0.cd_identityFacturaExtraida
LEFT JOIN dbo.TESch_BookingCosto bc
  ON bc.cd_identityBookingCosto = fec.cd_identityBookingCosto
 AND bc.cd_identityTenant = @p_tenant
LEFT JOIN dbo.TCSch_ConceptoFactura cf
  ON cf.cd_identityConceptoFactura = bc.cd_identityConceptoFactura
 AND cf.cd_identityTenant = @p_tenant
LEFT JOIN dbo.TCSch_Directorio dir
  ON dir.cd_identityDirectorio = bc.cd_identityDirectorio
LEFT JOIN dbo.TCSch_PaisMoneda pm
  ON pm.cd_identityPaisMoneda = bc.cd_identityPaisMoneda
OUTER APPLY (
  SELECT TOP (1) ref.tx_referencia
  FROM dbo.TESch_BookingPartesInvolucradas AS ref
  WHERE ref.cd_identityBooking = bc.cd_identityBooking
    AND NULLIF(LTRIM(RTRIM(ref.tx_referencia)), '''') IS NOT NULL
  ORDER BY ref.cd_identityBookingPartesInvolucradas DESC
) AS bpi'
  + @fproJoin + N'
WHERE f0.cd_identityFacturaExtraida = @p_factura
ORDER BY bc.cd_identityBookingCosto;';

EXEC sys.sp_executesql @sql,
  N'@p_tenant INT, @p_factura BIGINT',
  @p_tenant = @cd_identityTenant, @p_factura = @cd_identityFacturaExtraida;

/* Reading the result:
 *   - 1 row, estado='pending'   -> worker never tagged it (no contabilizada row)
 *   - 1 row, estado='unmatched' -> worker ran but couldn't resolve a provision (booking_cost_id NULL)
 *   - N rows, estado='matched'  -> provisions found, not yet billed in legacy (booked_* NULL)
 *   - N rows, estado='booked'   -> billed in legacy; booked_cd_identityFactura / booked_nu_factura set
 *   booked_* columns are the legacy invoice it was booked to; shipment_reference / booking_id /
 *   provision_amount / provision_currency / vendor_name / concepto give the rest of the context.
 */

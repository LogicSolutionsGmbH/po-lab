/* WORKER · STEP 3 · is this provision already invoiced in the legacy FPRO tables?  (country-agnostic)
 * VERBATIM source: src/activities/check-invoice-existence-activities/invoice.already.booked.helper.ts
 *   - SP block: :63-73   - link query: :119-142   - vw merge: :158-163   - moneda: :172-176
 * The source resolves the FPRO detail/header table NAMES at runtime (spp_ObtieneTablaPorPais)
 * and interpolates them into the query; tenant + booking-costo ids are bound parameters.
 * This replays that faithfully via sp_executesql, so it works for ANY country (no hardcoded MX).
 * Worker reports only the FIRST factura id found (see j2 for the journeys all-facturas variant).
 *
 * Params:
 *   @cd_identityPais   = provision's cd_identityPaisResponsable (from resolveProvision)
 *   @cd_identityTenant = TCSch_DatosRFC.cd_identityDatosRFC (directoryTenantId)
 *   #bc                = TESch_BookingCosto ids being checked
 */
SET NOCOUNT ON;

DECLARE @cd_identityPais   INT = NULL;   -- fill in
DECLARE @cd_identityTenant INT = NULL;   -- fill in

IF OBJECT_ID('tempdb..#bc') IS NOT NULL DROP TABLE #bc;
CREATE TABLE #bc (id BIGINT PRIMARY KEY);
-- INSERT INTO #bc (id) VALUES (...);  -- cd_identityBookingCosto list

/* (1) Resolve country-specific table-name suffixes (e.g. FproDetalleMex / FproMex, FproDetalleAle / FproAle, ...) */
DECLARE @detailSuffix NVARCHAR(50), @headerSuffix NVARCHAR(50), @dummyDate NVARCHAR(50);
EXEC [dbo].[spp_ObtieneTablaPorPais] @cd_identityPais=@cd_identityPais,
  @dataType='tp_tablaFacturaCompraDetalle', @TableName=@detailSuffix OUTPUT, @DateFieldName=@dummyDate OUTPUT;
EXEC [dbo].[spp_ObtieneTablaPorPais] @cd_identityPais=@cd_identityPais,
  @dataType='tp_tablaFacturaCompra',        @TableName=@headerSuffix OUTPUT, @DateFieldName=@dummyDate OUTPUT;

/* (2) Build identifiers exactly like the TS code:
 *     detailTable = 'TESch_Factura'+detailSuffix ; headerTable = 'TESch_Factura'+headerSuffix
 *     fkColumn    = 'cd_identityFactura'+headerSuffix  (== vw.cd_identityFactura) */
DECLARE @detailTable SYSNAME = N'TESch_Factura'     + LTRIM(RTRIM(@detailSuffix));
DECLARE @headerTable SYSNAME = N'TESch_Factura'     + LTRIM(RTRIM(@headerSuffix));
DECLARE @fkColumn    SYSNAME = N'cd_identityFactura' + LTRIM(RTRIM(@headerSuffix));

/* (3) Dynamic link query — names interpolated, tenant bound as a parameter (matches source) */
DECLARE @sql NVARCHAR(MAX) = N'
SELECT
  fd.cd_identityBookingCosto AS provision_id,
  f.' + QUOTENAME(@fkColumn) + N' AS cd_identityFactura,
  bpi.tx_referencia
FROM dbo.' + QUOTENAME(@detailTable) + N' fd WITH (NOLOCK)
INNER JOIN dbo.' + QUOTENAME(@headerTable) + N' f WITH (NOLOCK)
  ON f.' + QUOTENAME(@fkColumn) + N' = fd.' + QUOTENAME(@fkColumn) + N'
INNER JOIN dbo.TESch_BookingPartesInvolucradas bpi WITH (NOLOCK)
  ON bpi.cd_identityBooking = fd.cd_identityBooking
 AND bpi.cd_identityDirectorio = (
       SELECT cd_identityDirectorio FROM dbo.TCSch_DatosRFC WITH (NOLOCK)
       WHERE cd_identityDatosRFC = @p_tenant
     )
WHERE fd.cd_identityBookingCosto IN (SELECT id FROM #bc)
  AND fd.cd_identityTenant = @p_tenant
  AND f.st_cancelada <> ''S''
  AND f.st_estatus = ''A'';';

EXEC sys.sp_executesql @sql, N'@p_tenant INT', @p_tenant = @cd_identityTenant;

/* (4) Enrichment for the FIRST cd_identityFactura found (worker takes distinctFacturaIds[0]):
 *   SELECT * FROM dbo.vw_FacturaMultiTenantGlobal
 *   WHERE cd_identityFactura = @firstFacturaId AND cd_identityTenant = @cd_identityTenant;
 *   SELECT cd_identityMoneda, tx_acronimoMoneda FROM dbo.TCSch_Moneda WHERE cd_identityMoneda IN (...);
 *
 * Decision: matchProvision() compares invoice numbers digits-only.
 *   match -> tag st_estatus = 1 (booked) ; no match -> st_estatus = 0 (matched).
 */

/* JOURNEYS · STEP 3 · is this provision already invoiced in the legacy FPRO tables?  (country-agnostic)
 * VERBATIM source: src/server-actions/api/invoices/invoice-already-exist.data.ts
 *   - country resolve (step 0): :117-155   - SP block: :92-102   - link query: :195-222
 *   - vw merge: :243-248   - booked-by user: :259-263   - moneda: :274-278
 * Twin of worker w2. Differences: country is DERIVED from TESch_BookingCosto (not a param),
 * it reports ALL facturas (IN distinctFacturaIds), and selects nu_internoFactura
 * (ALE-like headers only) + cd_identityUsuario (booked-by). Replays the source's runtime
 * table-name resolution via sp_executesql, so it works for ANY country.
 *
 * Params:
 *   @cd_identityTenant = tenant id
 *   #bc                = TESch_BookingCosto ids being checked
 */
SET NOCOUNT ON;

DECLARE @cd_identityTenant INT = NULL;   -- fill in

IF OBJECT_ID('tempdb..#bc') IS NOT NULL DROP TABLE #bc;
CREATE TABLE #bc (id BIGINT PRIMARY KEY);
-- INSERT INTO #bc (id) VALUES (...);  -- cd_identityBookingCosto list

/* (0) Country is read from the provisions themselves; source REQUIRES exactly one distinct
 *     non-null cd_identityPaisResponsable (else it throws InvoiceAlreadyExistInputError). */
DECLARE @cd_identityPais INT;
SELECT @cd_identityPais = MIN(cd_identityPaisResponsable)
FROM TESch_BookingCosto
WHERE cd_identityBookingCosto IN (SELECT id FROM #bc)
  AND cd_identityTenant = @cd_identityTenant;
IF (SELECT COUNT(DISTINCT ISNULL(cd_identityPaisResponsable,-1))
    FROM TESch_BookingCosto
    WHERE cd_identityBookingCosto IN (SELECT id FROM #bc)
      AND cd_identityTenant = @cd_identityTenant) <> 1
   OR @cd_identityPais IS NULL
  THROW 50001, 'Booking costs must resolve to exactly one non-null responsible country.', 1;

/* (1) Resolve country-specific table-name suffixes */
DECLARE @detailSuffix NVARCHAR(50), @headerSuffix NVARCHAR(50), @dummyDate NVARCHAR(50);
EXEC [dbo].[spp_ObtieneTablaPorPais] @cd_identityPais=@cd_identityPais,
  @dataType='tp_tablaFacturaCompraDetalle', @TableName=@detailSuffix OUTPUT, @DateFieldName=@dummyDate OUTPUT;
EXEC [dbo].[spp_ObtieneTablaPorPais] @cd_identityPais=@cd_identityPais,
  @dataType='tp_tablaFacturaCompra',        @TableName=@headerSuffix OUTPUT, @DateFieldName=@dummyDate OUTPUT;

/* (2) Build identifiers like the TS code. nu_internoFactura column is emitted only for
 *     ALE-like header suffixes (FproAle/FproMor/FproBol/FproChi/FproCol/FproEcu/FproPer/
 *     FproUru/FproVen/FproBra/FproUsa); otherwise CAST(NULL AS INT). */
DECLARE @detailTable SYSNAME = N'TESch_Factura'     + LTRIM(RTRIM(@detailSuffix));
DECLARE @headerTable SYSNAME = N'TESch_Factura'     + LTRIM(RTRIM(@headerSuffix));
DECLARE @fkColumn    SYSNAME = N'cd_identityFactura' + LTRIM(RTRIM(@headerSuffix));
DECLARE @nuInternoExpr NVARCHAR(100) =
  CASE WHEN LTRIM(RTRIM(@headerSuffix)) IN
         ('FproAle','FproMor','FproBol','FproChi','FproCol','FproEcu',
          'FproPer','FproUru','FproVen','FproBra','FproUsa')
       THEN N'f.nu_internoFactura' ELSE N'CAST(NULL AS INT)' END;

/* (3) Dynamic link query — names interpolated, tenant bound as a parameter (matches source) */
DECLARE @sql NVARCHAR(MAX) = N'
SELECT
  fd.cd_identityBookingCosto AS provision_id,
  f.' + QUOTENAME(@fkColumn) + N' AS cd_identityFactura,
  bpi.tx_referencia,
  ' + @nuInternoExpr + N' AS nu_internoFactura,
  f.cd_identityUsuario AS booked_by_user_id
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

/* (4) Enrichment for ALL distinct cd_identityFactura found:
 *   SELECT * FROM vw_FacturaMultiTenantGlobal
 *   WHERE cd_identityFactura IN (...) AND cd_identityTenant = @cd_identityTenant;
 *   SELECT cd_identityUsuario, nb_nombre FROM TCSch_Usuario WHERE cd_identityUsuario IN (...);
 *   SELECT cd_identityMoneda, tx_acronimoMoneda FROM TCSch_Moneda WHERE cd_identityMoneda IN (...);
 */

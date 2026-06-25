/* WORKER · STEP 3 · is this provision already invoiced in the legacy FPRO tables?
 * VERBATIM source: src/activities/check-invoice-existence-activities/invoice.already.booked.helper.ts
 *   - SP block: :63-73   - link query: :119-142   - vw merge: :158-163   - moneda: :172-176
 * Worker passes cd_identityPaisResponsable in; reports only the FIRST factura id found.
 *
 * Params:
 *   @cd_identityPais   = provision's cd_identityPaisResponsable (from resolveProvision)
 *   @cd_identityTenant = TCSch_DatosRFC.cd_identityDatosRFC (directoryTenantId)
 *   @bookingCostoIds   = the TESch_BookingCosto ids being checked
 */
DECLARE @cd_identityPais   INT = NULL;   -- fill in
DECLARE @cd_identityTenant INT = NULL;   -- fill in
DECLARE @bookingCostoIds TABLE (id BIGINT PRIMARY KEY);
-- INSERT INTO @bookingCostoIds (id) VALUES (...);

/* (1) Resolve country-specific table name SUFFIXES. detailTable = 'TESch_Factura'+TableName,
 *     headerTable likewise; fkColumn = 'cd_identity'+header(without 'TESch_'). */
DECLARE @detailTableName NVARCHAR(50), @headerTableName NVARCHAR(50), @dummyDate NVARCHAR(50);
EXEC [dbo].[spp_ObtieneTablaPorPais] @cd_identityPais=@cd_identityPais,
  @dataType='tp_tablaFacturaCompraDetalle', @TableName=@detailTableName OUTPUT, @DateFieldName=@dummyDate OUTPUT;
EXEC [dbo].[spp_ObtieneTablaPorPais] @cd_identityPais=@cd_identityPais,
  @dataType='tp_tablaFacturaCompra',        @TableName=@headerTableName OUTPUT, @DateFieldName=@dummyDate OUTPUT;
SELECT @detailTableName AS detailSuffix, @headerTableName AS headerSuffix;  -- e.g. FproDetalleMex / FproMex

/* (2) Link query — VERBATIM shape (substitute the resolved table/column names from step 1).
 *     Example for Mexico: detail=TESch_FacturaFproDetalleMex, header=TESch_FacturaFproMex,
 *     fk=cd_identityFacturaFproMex. */
SELECT
  fd.cd_identityBookingCosto AS provision_id,
  f.cd_identityFacturaFproMex AS cd_identityFactura,         -- f.{fkColumn}
  bpi.tx_referencia
FROM dbo.TESch_FacturaFproDetalleMex fd WITH (NOLOCK)        -- dbo.{detailTable}
INNER JOIN dbo.TESch_FacturaFproMex f WITH (NOLOCK)          -- dbo.{headerTable}
  ON f.cd_identityFacturaFproMex = fd.cd_identityFacturaFproMex   -- f.{fk} = fd.{fk}
INNER JOIN dbo.TESch_BookingPartesInvolucradas bpi WITH (NOLOCK)
  ON bpi.cd_identityBooking = fd.cd_identityBooking
 AND bpi.cd_identityDirectorio = (
       SELECT cd_identityDirectorio
       FROM dbo.TCSch_DatosRFC WITH (NOLOCK)
       WHERE cd_identityDatosRFC = @cd_identityTenant
     )
WHERE fd.cd_identityBookingCosto IN (SELECT id FROM @bookingCostoIds)
  AND fd.cd_identityTenant = @cd_identityTenant
  AND f.st_cancelada <> 'S'
  AND f.st_estatus = 'A';

/* (3) Enrichment for the first cd_identityFactura found:
 *   SELECT * FROM dbo.vw_FacturaMultiTenantGlobal
 *   WHERE cd_identityFactura = @firstFacturaId AND cd_identityTenant = @cd_identityTenant;
 *   SELECT cd_identityMoneda, tx_acronimoMoneda FROM dbo.TCSch_Moneda WHERE cd_identityMoneda IN (...);
 *
 * Decision: matchProvision() normalizes both invoice numbers to digits-only and compares.
 *   match -> tag st_estatus = 1 (booked) ; no match -> st_estatus = 0 (matched).
 */

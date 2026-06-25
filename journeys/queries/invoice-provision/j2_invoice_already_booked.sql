/* JOURNEYS · STEP 3 · is this provision already invoiced in the legacy FPRO tables?
 * VERBATIM source: src/server-actions/api/invoices/invoice-already-exist.data.ts
 *   - country resolve (step 0): :117-155   - SP block: :92-102   - link query: :195-222
 *   - vw merge: :243-248   - booked-by user: :259-263   - moneda: :274-278
 * Twin of worker w2, with two differences: country is DERIVED here (not a param), and it
 * reports ALL facturas (IN distinctFacturaIds) + selects nu_internoFactura & booked-by user.
 *
 * Params:
 *   @cd_identityTenant = tenant id
 *   @bookingCostoIds   = TESch_BookingCosto ids being checked
 */
DECLARE @cd_identityTenant INT = NULL;   -- fill in
DECLARE @bookingCostoIds TABLE (id BIGINT PRIMARY KEY);
-- INSERT INTO @bookingCostoIds (id) VALUES (...);

/* (0) Country is read from the provisions themselves (must be exactly one non-NULL country): */
SELECT cd_identityBookingCosto, cd_identityPaisResponsable
FROM TESch_BookingCosto
WHERE cd_identityBookingCosto IN (SELECT id FROM @bookingCostoIds)
  AND cd_identityTenant = @cd_identityTenant;
-- take the single distinct cd_identityPaisResponsable -> @cd_identityPais, then:

/* (1) spp_ObtieneTablaPorPais x2 for detail+header suffixes (same as worker w2 step 1). */

/* (2) Link query — VERBATIM shape (Mexico example tables shown; nu_internoFactura only emitted
 *     for ALE-like FPRO headers, else CAST(NULL AS INT)). */
SELECT
  fd.cd_identityBookingCosto AS provision_id,
  f.cd_identityFacturaFproMex AS cd_identityFactura,         -- f.{fkColumn}
  bpi.tx_referencia,
  f.nu_internoFactura AS nu_internoFactura,                  -- or CAST(NULL AS INT) for non-ALE headers
  f.cd_identityUsuario AS booked_by_user_id
FROM dbo.TESch_FacturaFproDetalleMex fd WITH (NOLOCK)        -- dbo.{detailTable}
INNER JOIN dbo.TESch_FacturaFproMex f WITH (NOLOCK)          -- dbo.{headerTable}
  ON f.cd_identityFacturaFproMex = fd.cd_identityFacturaFproMex
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

/* (3) Enrichment for ALL distinct cd_identityFactura found:
 *   SELECT * FROM vw_FacturaMultiTenantGlobal
 *   WHERE cd_identityFactura IN (...) AND cd_identityTenant = @cd_identityTenant;
 *   SELECT cd_identityUsuario, nb_nombre FROM TCSch_Usuario WHERE cd_identityUsuario IN (...);
 *   SELECT cd_identityMoneda, tx_acronimoMoneda FROM TCSch_Moneda WHERE cd_identityMoneda IN (...);
 */

/* JOURNEYS · STEP 1 · per-invoice provision badge state (matched / booked)
 * Source: src/server-actions/api/invoices/invoices.service.ts:900-911 (Kysely builder).
 * Below is the faithful compiled T-SQL. Badge semantics: invoices.provision-state.ts:7-12.
 *   st_estatus = 0 + cd_identityBookingCosto NOT NULL -> matched
 *   st_estatus = 1 + cd_identityBookingCosto NOT NULL -> booked
 * Placeholder rows (cd_identityBookingCosto NULL = unresolved/unmatched) are EXCLUDED here.
 *
 * Param: @facturaIds  = the cd_identityFacturaExtraida set being rendered in the inbox page.
 */
DECLARE @facturaIds TABLE (id BIGINT PRIMARY KEY);
-- INSERT INTO @facturaIds (id) VALUES (111),(222),(333);  -- fill in

SELECT
  fec.cd_identityFacturaExtraida,
  fec.cd_identityBookingCosto,
  fec.st_estatus
FROM TESch_FacturaExtraidaContabilizada AS fec
WHERE fec.cd_identityFacturaExtraida IN (SELECT id FROM @facturaIds)
  AND fec.st_estatus IN (0, 1)
  AND fec.cd_identityBookingCosto IS NOT NULL
ORDER BY fec.cd_identityFacturaExtraidaContabilizada DESC;

/* Companion: to SEE the unresolved/unmatched placeholders excluded above, run:
 *   SELECT cd_identityFacturaExtraida, st_estatus
 *   FROM TESch_FacturaExtraidaContabilizada
 *   WHERE cd_identityFacturaExtraida IN (SELECT id FROM @facturaIds)
 *     AND cd_identityBookingCosto IS NULL;
 */

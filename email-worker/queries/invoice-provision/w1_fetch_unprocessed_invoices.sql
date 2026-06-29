/* WORKER · STEP 1 · candidate work-list: extracted AP invoices not yet tagged with a provision
 * VERBATIM source: src/activities/check-invoice-existence-activities/fetch.unprocessed.invoices.ts:42-69
 * Drains the queue for tagProvisionWithInvoiceWorkflow. Anti-join on the non-NULL tag means
 * the workflow always pages with offset = 0 (each pass shrinks the set from the front).
 *
 * Params:
 *   @tx_tipoDocumentoNegocio = 'Accounts Payable Invoice'  (AP_INVOICE_DOCUMENT_TYPE constant)
 *   @offset                  = activity input, default 0   (workflow passes 0)
 *   @limit                   = FETCH_UNPROCESSED_INVOICES_PAGE_SIZE (default 400)
 * Source uses double-quoted ANSI identifiers; runs as-is under QUOTED_IDENTIFIER ON.
 */
DECLARE @tx_tipoDocumentoNegocio NVARCHAR(100) = 'Accounts Payable Invoice';
DECLARE @offset INT = 0;
DECLARE @limit  INT = 400;

SELECT
  f."cd_identityFacturaExtraida",
  f."cd_identityActivoDigital",
  c."cd_identityClasificacionActivoDigital",
  f."cd_identityTenant",
  f."tx_identificacionFiscalProveedor",
  c."tx_emisor",
  c."tx_numeroReferenciaDocumento",
  f."tx_moneda",
  f."im_subtotal",
  f."im_impuestoTotal",
  f."im_total",
  f."tx_datosExtraccionCompletos"
FROM "TESch_FacturaExtraida" f
INNER JOIN "TESch_ClasificacionActivoDigital" c
  ON c."cd_identityActivoDigital" = f."cd_identityActivoDigital"
WHERE c."tx_tipoDocumentoNegocio" = @tx_tipoDocumentoNegocio
  AND NOT EXISTS (
    SELECT 1
    FROM "TESch_FacturaExtraidaContabilizada" fec_tagged
    WHERE fec_tagged."cd_identityFacturaExtraida" = f."cd_identityFacturaExtraida"
      AND fec_tagged."cd_identityBookingCosto" IS NOT NULL
  )
ORDER BY f."cd_identityFacturaExtraida" ASC
OFFSET @offset ROWS
FETCH NEXT @limit ROWS ONLY;

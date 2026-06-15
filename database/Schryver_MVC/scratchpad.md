# Schryver_MVC — scratchpad

## Scope (2026-06-15)

View for listing users who need email OAuth reauthentication, filterable by headquarters
identity directory (`cd_identityDirectorioSede`).

## Done

- Added `db/views/vw_UsuariosReautenticacionCorreoPorGrupo.sql`
  - Source: `TESch_CuentaCorreo` (`st_requiereReautenticacion = 1`, `fg_activo = 1`)
  - User → company via `TCSch_Usuario` → `TCSch_Sucursal` → `TCSch_Directorio`
  - HQ group: `COALESCE(d.cd_identityDirectorioSede, d.cd_identityDirectorio)`
  - Validated against live DB (HQ 1043 → 11 rows)

## Open

- Promote view to `Logic-Solutions-GmbH/databases` repo when ready for deployment
- Confirm whether inactive users (`st_estatus = 'N'`) should be excluded at view level

## Assumptions

- Corporate group = companies sharing the same `cd_identityDirectorioSede` (matches
  `udf_ObtieneGrupoSedeTenant` / `TCSch_Directorio` sede model)
- Reauthentication signal is `TESch_CuentaCorreo.st_requiereReautenticacion`, not token expiry

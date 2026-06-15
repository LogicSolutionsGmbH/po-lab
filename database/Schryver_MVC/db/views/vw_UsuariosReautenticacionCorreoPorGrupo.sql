-- =============================================================================
-- View: vw_UsuariosReautenticacionCorreoPorGrupo
-- Database: Schryver_MVC
--
-- Lists users whose connected email accounts (OAuth providers) require
-- reauthentication, scoped to a corporate group via headquarters identity
-- directory (cd_identityDirectorioSede).
--
-- Group membership: all companies where cd_identityDirectorio = HQ or
-- cd_identityDirectorioSede = HQ. Users are resolved through their branch
-- (TCSch_Sucursal.cd_identityDirectorio).
--
-- Usage:
--   SELECT *
--   FROM dbo.vw_UsuariosReautenticacionCorreoPorGrupo
--   WHERE cd_identityDirectorioSede = @cd_identityDirectorioSede;
-- =============================================================================

CREATE OR ALTER VIEW [dbo].[vw_UsuariosReautenticacionCorreoPorGrupo]
AS
SELECT
    sede.cd_identityDirectorio                    AS cd_identityDirectorioSede,
    sede.nb_nombreDirectorio                      AS nb_nombreDirectorioSede,
    d.cd_identityDirectorio,
    d.nb_nombreDirectorio,
    s.cd_identitySucursal,
    s.tx_sucursal,
    u.cd_identityUsuario,
    u.cd_usuario,
    u.nb_nombre                                   AS nb_nombreUsuario,
    u.tx_correo                                   AS tx_correoUsuario,
    u.st_estatus                                  AS st_estatusUsuario,
    cc.cd_identityCuentaCorreo,
    cc.tx_proveedor,
    cc.tx_correoElectronico,
    cc.fg_activo,
    cc.st_requiereReautenticacion,
    cc.fh_creacion                                AS fh_creacionCuentaCorreo,
    cc.fh_actualizacion                           AS fh_actualizacionCuentaCorreo,
    cc.fh_ultimoCorreoRastreado
FROM dbo.TESch_CuentaCorreo AS cc
INNER JOIN dbo.TCSch_Usuario AS u
    ON u.cd_identityUsuario = cc.cd_identityUsuario
INNER JOIN dbo.TCSch_Sucursal AS s
    ON s.cd_identitySucursal = u.cd_identitySucursal
INNER JOIN dbo.TCSch_Directorio AS d
    ON d.cd_identityDirectorio = s.cd_identityDirectorio
INNER JOIN dbo.TCSch_Directorio AS sede
    ON sede.cd_identityDirectorio = COALESCE(d.cd_identityDirectorioSede, d.cd_identityDirectorio)
WHERE cc.st_requiereReautenticacion = 1
  AND cc.fg_activo = 1;

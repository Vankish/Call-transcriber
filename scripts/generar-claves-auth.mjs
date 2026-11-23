// Genera el par de claves con el que Convex Auth firma las sesiones
// (JWT_PRIVATE_KEY y JWKS) y las enseña por pantalla para pegarlas en el panel
// de Convex. No las guarda en ningún archivo a propósito: son secretas y este
// repositorio es público. Una vez por despliegue (si se cambian, todo el mundo
// tiene que volver a entrar).
//
//   node scripts/generar-claves-auth.mjs
//
// Es lo mismo que hace el "Manual setup" de la documentación de Convex Auth.

import { exportJWK, exportPKCS8, generateKeyPair } from 'jose'

const keys = await generateKeyPair('RS256', { extractable: true })
const privateKey = (await exportPKCS8(keys.privateKey)).trimEnd().replace(/\n/g, ' ')
const jwks = JSON.stringify({ keys: [{ use: 'sig', ...(await exportJWK(keys.publicKey)) }] })

console.log('\nCopia cada valor ENTERO (es una sola línea larga) en su variable del panel de Convex.\n')
console.log('── JWT_PRIVATE_KEY ──')
console.log(privateKey)
console.log('\n── JWKS ──')
console.log(jwks)
console.log('\nNo los pegues en ningún archivo del proyecto ni en un chat.\n')

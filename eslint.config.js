import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'release']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Un guion bajo delante = "ya se que no se usa, esta ahi a proposito".
      // Es la convencion que ya seguia el codigo; aqui solo se le dice a eslint.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // ── Reglas del compilador de React: aviso, no error ──────────────────
      //
      // Llegaron con eslint-plugin-react-hooks 7 y marcan patrones que ya
      // estaban escritos en App.tsx desde el principio: estado que se calcula a
      // partir de otro estado dentro de un efecto, sobre todo. No son fallos:
      // la app funciona. Pero arreglarlos de verdad es reordenar el estado de un
      // componente de 4.600 lineas que solo se puede probar a mano, con micro,
      // audio de sistema y una clave de IA delante.
      //
      // Se quedan como AVISO para que sigan a la vista y se vayan quitando al
      // tocar cada pantalla, en vez de silenciarlos con un disable que nadie
      // vuelve a mirar. Que salgan en verde los errores de verdad (un import que
      // sobra, una variable mal escrita) es lo que hace util el lint.
      //
      // Pendientes a fecha 2026-09-04:
      //   set-state-in-effect  → carga inicial desde localStorage, autoseleccion
      //                          de entrevista, borrador de transcripcion
      //   immutability         → funciones del componente usadas dentro de efectos
      //   preserve-manual-...  → useCallback que depende de otro useCallback
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
])

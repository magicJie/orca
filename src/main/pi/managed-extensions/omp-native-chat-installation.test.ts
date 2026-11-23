import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { PiTitlebarExtensionService } from './titlebar-extension-service'

it('installs native chat extensions into OMP homes, not Pi homes', () => {
  const temp = mkdtempSync(join(tmpdir(), 'orca-omp-native-chat-install-'))
  try {
    const service = new PiTitlebarExtensionService()
    const omp = join(temp, 'omp')
    const pi = join(temp, 'pi')
    service.installManagedExtensions(omp, 'omp')
    service.installManagedExtensions(pi, 'pi')
    for (const file of ['orca-omp-native-chat.ts', 'orca-omp-native-chat-notify.ts']) {
      expect(existsSync(join(omp, 'extensions', file))).toBe(true)
      expect(existsSync(join(pi, 'extensions', file))).toBe(false)
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

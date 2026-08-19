import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inject } from '../src/client/index.ts'

interface PackageManifest {
  readonly dsh?: {
    readonly client?: {
      readonly inject?: readonly string[]
    }
  }
}

describe('A2A browser manifest', () => {
  it('loads after the browser Remote provider', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as PackageManifest

    expect(manifest.dsh?.client?.inject).toContain('@deepseek-ai/dsh-api-remotes')
    expect(inject).toContain('remote')
    expect(inject).not.toContain('remote.a2a')
  })
})

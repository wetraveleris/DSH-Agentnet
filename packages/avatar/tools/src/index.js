export const name = 'avatar-tools'
export const inject = ['tools']
export function apply(ctx) {
  ctx.effect(() => ctx.tools.register({
    name: 'avatar_ping',
    description: 'Avatar tool: echo a message and confirm the Avatar tool layer is alive.',
    parameters: { type: 'object', properties: { message: { type: 'string', description: 'text to echo' } }, required: ['message'], additionalProperties: false },
    output: { schema: { type: 'object', properties: {}, additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args) { return { ok: true, echo: String(args?.message ?? ''), layer: 'avatar-tools' } },
  }))
}

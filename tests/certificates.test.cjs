const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const source = fs.readFileSync('src/App.tsx', 'utf8')
const code = ts.transpileModule(source.slice(source.indexOf('const uploadCertificate ='), source.indexOf('const getFirebaseErrorMessage')), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function setup(compressed) {
  const uploads = [], auth = []
  const context = { storage: {}, crypto: { randomUUID: () => 'unique' }, ensureAnonymousAuth: async () => auth.push(true), compressImageToWebp: async () => compressed, storageRef: (_, path) => path, uploadBytes: async (path, content, metadata) => { uploads.push({ path, content, metadata }); return { ref: path } }, getDownloadURL: async () => 'https://example.com/certificate' }
  vm.runInNewContext(code + '\nglobalThis.upload = uploadCertificate', context)
  return { upload: context.upload, uploads, auth }
}
test('PDF remains unchanged and authenticates before upload', async () => {
  const ui = setup(), file = { name: 'ticket.pdf', type: 'application/pdf', size: 100 }
  const attachment = await ui.upload(file)
  assert.equal(ui.uploads[0].content, file)
  assert.equal(ui.auth.length, 1)
  assert.equal(attachment.type, file.type)
})
test('converted image metadata and extension match the uploaded bytes', async () => {
  const ui = setup({ type: 'image/webp', size: 50 })
  const result = await ui.upload({ name: 'ticket.jpg', type: 'image/jpeg', size: 100 })
  assert.equal(result.name, 'ticket.webp')
  assert.equal(ui.uploads[0].metadata.contentType, 'image/webp')
  assert.match(ui.uploads[0].path, /unique-ticket.webp$/)
})
test('retained original uses its own MIME type and extension', async () => {
  const ui = setup({ type: 'image/png', size: 50 })
  assert.equal((await ui.upload({ name: 'ticket.png', type: 'image/png', size: 50 })).type, 'image/png')
  assert.equal(ui.uploads[0].metadata.contentType, 'image/png')
})
test('unsupported, empty and over-limit files are never uploaded', async () => {
  const ui = setup()
  for (const file of [{ type: 'text/plain', size: 1 }, { type: 'application/pdf', size: 0 }, { type: 'application/pdf', size: 10 * 1024 * 1024 }]) await assert.rejects(ui.upload(file))
  assert.equal(ui.uploads.length, 0)
})

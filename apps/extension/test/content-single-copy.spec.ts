/// <reference types="chrome" />
declare function require(id: string): unknown
import { installChromeMock } from './chrome-mock'

/** A re-injected content script must never add a second listener: one intent, one write. */
it('a second copy of the content script does not listen', () => {
  const mock = installChromeMock()
  jest.isolateModules(() => {
    require('../src/content')
  })
  jest.isolateModules(() => {
    require('../src/content')
  })
  expect(mock.listeners.onMessage).toHaveLength(1)
})

import { topDialog } from '../src/executor/resolve-target'

it('the open dialog is the outermost one, not an info box inside it', () => {
  document.body.innerHTML = `
    <mat-dialog-container role="dialog"><div class="info alert" role="dialog">You must select 1 address</div>
      <select id="countryOfResidence_select"></select></mat-dialog-container>`
  expect(topDialog()?.tagName).toBe('MAT-DIALOG-CONTAINER')
  expect(topDialog()?.querySelector('#countryOfResidence_select')).not.toBeNull()
})

it('an inline warning box marked role="dialog" is not an open dialog (IRCC Activities page)', () => {
  document.body.innerHTML = `
    <main><div class="warning alert" role="dialog">You must complete this entire section</div></main>`
  expect(topDialog()).toBeNull()
  document.body.innerHTML += `<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><select id="x"></select></mat-dialog-container></div>`
  expect(topDialog()?.tagName).toBe('MAT-DIALOG-CONTAINER')
})

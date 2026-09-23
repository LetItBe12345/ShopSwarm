export type BrowserAction =
  | 'open'
  | 'click'
  | 'fill'
  | 'select'
  | 'press'
  | 'scroll'
  | 'wait'
  | 'back'
  | 'close'

export interface BrowserElementRef {
  readonly session: string
  readonly pageRevision: number
  readonly ref: `e${number}`
  readonly role: string
  readonly name: string
}

export interface BrowserPageState {
  readonly session: string
  readonly revision: number
  readonly origin: string
  readonly tree: string
  readonly elements: readonly BrowserElementRef[]
  readonly removedRefs: readonly string[]
}

export type BrowserErrorCode =
  | 'cancelled'
  | 'command_failed'
  | 'invalid_argument'
  | 'invalid_result'
  | 'stale_element_reference'
  | 'transport_error'
  | 'timeout'

export interface BrowserError {
  readonly code: BrowserErrorCode
  readonly message: string
}

interface BrowserActionResultBase {
  readonly action: BrowserAction
  readonly page?: BrowserPageState
  readonly observationError?: BrowserError
}

export interface BrowserActionSuccess extends BrowserActionResultBase {
  readonly status: 'success'
}

export interface BrowserActionFailure extends BrowserActionResultBase {
  readonly status: 'failure'
  readonly error: BrowserError
}

export interface BrowserActionUncertain extends BrowserActionResultBase {
  readonly status: 'uncertain'
  readonly error: BrowserError
}

export type BrowserActionResult =
  | BrowserActionSuccess
  | BrowserActionFailure
  | BrowserActionUncertain

export interface BrowserSnapshotSuccess {
  readonly status: 'success'
  readonly page: BrowserPageState
}

export interface BrowserSnapshotFailure {
  readonly status: 'failure'
  readonly error: BrowserError
}

export type BrowserSnapshotResult = BrowserSnapshotSuccess | BrowserSnapshotFailure

export type BrowserWaitCondition =
  | { readonly kind: 'text'; readonly value: string; readonly timeoutMs: number }
  | { readonly kind: 'url'; readonly value: string; readonly timeoutMs: number }
  | {
      readonly kind: 'load'
      readonly value: 'load' | 'domcontentloaded' | 'networkidle'
      readonly timeoutMs: number
    }

export type BrowserScrollDirection = 'up' | 'down' | 'left' | 'right'

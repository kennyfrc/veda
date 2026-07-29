/**
 * Type definitions for the program-design protocol.
 *
 * A "program design" is the structured output of the `navigator-design`
 * persona: types, method signatures, program layout, call stacks, and
 * invariants, emitted as a constrained XML subset. Veda parses and
 * validates it; the caller (pi, a human, another agent) implements
 * against it. Veda itself never writes to the repo.
 */

/** A file referenced by the design's layout. */
export interface DesignFile {
  path: string;
  role?: string;
}

/** A file the designer explicitly used or omitted (Taelin omit economy). */
export interface DesignContextEntry {
  file: string;
  /** Only present on <omitted> entries. */
  reason?: string;
}

/** A type definition emitted by the designer. */
export interface DesignType {
  name: string;
  file: string;
  /** Raw body text between the tags (fields, etc.). */
  body: string;
}

/** A parameter on a signature. */
export interface DesignParam {
  name: string;
  type: string;
}

/** A function/method signature — the contract the caller implements. */
export interface DesignSignature {
  name: string;
  file: string;
  kind: string;
  /** One-line contract comment. */
  contract?: string;
  params: DesignParam[];
  /** Return type + optional description. */
  returns?: { type: string; description?: string };
}

/** A step in a call stack — must resolve to a declared signature. */
export interface DesignCallstackStep {
  /** The signature name this step invokes. */
  ref: string;
}

/** An ordered sequence of signature invocations. */
export interface DesignCallstack {
  name: string;
  steps: DesignCallstackStep[];
}

/** A declared invariant on the design's state. */
export interface DesignInvariant {
  /** Plain-text invariant assertion. */
  text: string;
}

/** The parsed program-design protocol document. */
export interface ProgramDesign {
  name: string;
  task: string;
  intent: string;
  layout: DesignFile[];
  context: DesignContextEntry[];
  types: DesignType[];
  signatures: DesignSignature[];
  callstacks: DesignCallstack[];
  invariants: DesignInvariant[];
}

/** Result of extracting a <program> block from a response string. */
export type ParseResult =
  | { ok: true; xml: string; design: ProgramDesign }
  | { ok: false; reason: 'no-program-block' | 'malformed'; detail?: string };

/** A validation error tied to a specific part of the design. */
export interface ValidationError {
  /** Element kind the error concerns: signature, callstack, etc. */
  kind: string;
  message: string;
}

/** Result of validating a parsed ProgramDesign against the invariants. */
export interface ValidateResult {
  ok: boolean;
  errors: ValidationError[];
  warnings: string[];
}

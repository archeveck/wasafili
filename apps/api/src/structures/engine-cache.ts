import { Injectable } from '@nestjs/common';
import { createFormEngine, type FormEngine } from '@wasafili/form-engine';
import { type StructureDefinition } from '@wasafili/form-schema';

const MAX_ENTRIES = 500;

/**
 * Moteurs de formulaire par version publiée. Une version publiée est immuable (trigger en
 * base) : son moteur compilé peut être conservé sans invalidation.
 */
@Injectable()
export class EngineCache {
  private readonly engines = new Map<string, FormEngine>();

  get(version: { id: string; definition: unknown }): FormEngine {
    let engine = this.engines.get(version.id);
    if (!engine) {
      engine = createFormEngine(version.definition as StructureDefinition);
      if (this.engines.size >= MAX_ENTRIES) {
        this.engines.delete(this.engines.keys().next().value!);
      }
      this.engines.set(version.id, engine);
    }
    return engine;
  }
}

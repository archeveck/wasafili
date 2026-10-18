/** Erreur de formule, avec la position (index du caractère) pour l'éditeur. */
export class FormulaError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
    this.name = 'FormulaError';
  }
}

import openApiDocumentJson from './openapi.json';

// The CommonJS runtime serves the JSON file directly. This export keeps the
// inactive TypeScript prototype aligned with the active API contract.
export const openApiDocument = openApiDocumentJson;

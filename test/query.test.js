import test from 'node:test';
import assert from 'node:assert/strict';
import {
  batchDocumentsByByteBudget,
  buildEvidenceLedger,
  fitDocumentsToByteBudget,
  generateComprehensiveAnswer,
  validateGroundedAnswer,
  validateSynthesizedAnswer,
} from '../src/query.js';

const documents = [{
  wikiPage: 'sources/informe-medico.md',
  title: 'Informe Medico',
  type: 'source',
  rawSources: ['raw/informe-medico.pdf'],
  content: 'Se recetó una pomada el 3 de marzo.',
  evidence: [{
    rawSource: 'raw/informe-medico.pdf',
    locator: 'page 2',
    text: 'Se recetó una pomada el 3 de marzo.',
  }],
}];

test('query validation keeps only claims with an exact wiki/raw citation pair', () => {
  const result = validateGroundedAnswer({
    found: true,
    claims: [
      {
        text: 'Se recetó una pomada el 3 de marzo.',
        citations: [{
          wiki_page: 'sources/informe-medico.md',
          raw_source: 'raw/informe-medico.pdf',
          locator: 'page 2',
          quote: 'Se recetó una pomada el 3 de marzo.',
        }],
      },
      {
        text: 'La dosis fue dos veces al día.',
        citations: [{
          wiki_page: 'sources/informe-medico.md',
          raw_source: 'raw/otro.pdf',
          locator: 'page 2',
          quote: 'La dosis fue dos veces al día.',
        }],
      },
    ],
  }, documents);

  assert.equal(result.found, true);
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0].citations[0].wikiTitle, 'Informe Medico');
});

test('query validation returns not found when every model claim is unsupported', () => {
  const result = validateGroundedAnswer({
    found: true,
    claims: [{ text: 'Invented', citations: [] }],
  }, documents);

  assert.deepEqual(result, { found: false, sections: [], claims: [] });
});

test('query validation rejects a claim broader than its citation and a truncated quote', () => {
  const result = validateGroundedAnswer({
    found: true,
    claims: [
      {
        text: 'Reducir la grasa visceral reduce la inflamación sistémica y aumenta la longevidad.',
        citations: [{
          wiki_page: 'sources/informe-medico.md',
          raw_source: 'raw/informe-medico.pdf',
          locator: 'page 2',
          quote: 'Se recetó una pomada el 3 de marzo.',
        }],
      },
      {
        text: 'Se recetó una pomada el 3 de marzo y el tratamiento fue completo.',
        citations: [{
          wiki_page: 'sources/informe-medico.md',
          raw_source: 'raw/informe-medico.pdf',
          locator: 'page 2',
          quote: 'Se recetó una pomada el',
        }],
      },
    ],
  }, documents);

  assert.deepEqual(result, { found: false, sections: [], claims: [] });
});

test('query validation preserves rich sections and multiple claims from one document', () => {
  const result = validateGroundedAnswer({
    found: true,
    sections: [{
      title: 'Conclusiones',
      kind: 'conclusions',
      items: [
        {
          text: 'Se recetó una pomada el 3 de marzo.',
          citations: [{
            wiki_page: 'sources/informe-medico.md',
            raw_source: 'raw/informe-medico.pdf',
            locator: 'page 2',
            quote: 'Se recetó una pomada el 3 de marzo.',
          }],
        },
        {
          text: 'La pomada se recetó el 3 de marzo.',
          citations: [{
            wiki_page: 'sources/informe-medico.md',
            raw_source: 'raw/informe-medico.pdf',
            locator: 'page 2',
            quote: 'Se recetó una pomada el 3 de marzo.',
          }],
        },
      ],
    }],
  }, documents);

  assert.equal(result.found, true);
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].items.length, 2);
  assert.equal(result.claims.length, 2);
});

test('query validation rejects unsupported quantities even when the surrounding wording overlaps', () => {
  const result = validateGroundedAnswer({
    found: true,
    sections: [{
      title: 'Acciones',
      kind: 'actions',
      items: [{
        text: 'Se recetó una pomada dos veces al día durante 30 días.',
        citations: [{
          wiki_page: 'sources/informe-medico.md',
          raw_source: 'raw/informe-medico.pdf',
          locator: 'page 2',
          quote: 'Se recetó una pomada el 3 de marzo.',
        }],
      }],
    }],
  }, documents);

  assert.equal(result.found, false);
  assert.deepEqual(result.sections, []);
});

test('query context stays below the process argument byte budget', () => {
  const largeDocuments = Array.from({ length: 12 }, (_, index) => ({
    ...documents[0],
    wikiPage: `sources/page-${index}.md`,
    content: 'ñ'.repeat(10_000),
    evidence: [{ ...documents[0].evidence[0], text: 'á'.repeat(10_000) }],
  }));

  const selected = fitDocumentsToByteBudget(largeDocuments, 80_000);

  assert.ok(selected.length > 0);
  assert.ok(selected.length < largeDocuments.length);
  assert.ok(Buffer.byteLength(JSON.stringify(selected), 'utf8') <= 80_000);
});

test('comprehensive query batches documents below the subprocess byte budget', () => {
  const largeDocuments = Array.from({ length: 7 }, (_, index) => ({
    ...documents[0],
    wikiPage: `sources/page-${index}.md`,
    content: 'evidencia '.repeat(1_000),
  }));

  const batches = batchDocumentsByByteBudget(largeDocuments, 25_000);

  assert.ok(batches.length > 1);
  assert.equal(batches.flat().length, largeDocuments.length);
  assert.ok(batches.every((batch) => Buffer.byteLength(JSON.stringify(batch), 'utf8') <= 25_000));
});

test('citation-preserving synthesis expands ledger ids into exact citations', () => {
  const mapped = [validateGroundedAnswer({
    found: true,
    sections: [{
      title: 'Hallazgos',
      kind: 'conclusions',
      items: [{
        text: 'Se recetó una pomada el 3 de marzo.',
        citations: [{
          wiki_page: 'sources/informe-medico.md',
          raw_source: 'raw/informe-medico.pdf',
          locator: 'page 2',
          quote: 'Se recetó una pomada el 3 de marzo.',
        }],
      }],
    }],
  }, documents)];
  const ledger = buildEvidenceLedger(mapped);
  const result = validateSynthesizedAnswer({
    found: true,
    sections: [{
      title: 'Respuesta detallada',
      kind: 'answer',
      items: [{
        text: 'La evidencia indica que la pomada se recetó el 3 de marzo.',
        evidence_ids: ['E1'],
      }],
    }],
  }, ledger);

  assert.equal(result.found, true);
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0].citations[0].rawSource, 'raw/informe-medico.pdf');
});

test('citation-preserving synthesis rejects unsupported quantities and unknown ids', () => {
  const ledger = [{
    id: 'E1',
    finding: 'Se recetó una pomada el 3 de marzo.',
    section: 'Hallazgos',
    citations: [{
      wikiPage: 'sources/informe-medico.md',
      rawSource: 'raw/informe-medico.pdf',
      wikiTitle: 'Informe Medico',
      locator: 'page 2',
      quote: 'Se recetó una pomada el 3 de marzo.',
    }],
  }];
  const result = validateSynthesizedAnswer({
    found: true,
    sections: [{
      title: 'Respuesta',
      kind: 'answer',
      items: [
        { text: 'La pomada debe usarse 30 días.', evidence_ids: ['E1'] },
        { text: 'Se recetó una pomada el 3 de marzo.', evidence_ids: ['E404'] },
      ],
    }],
  }, ledger);

  assert.equal(result.found, false);
  assert.deepEqual(result.claims, []);
});

test('comprehensive mode maps evidence then synthesizes through ledger ids', async () => {
  const calls = [];
  const generator = {
    available: true,
    async generateJson(request) {
      calls.push(request.schemaName);
      if (request.schemaName === 'grounded_evidence_findings') {
        return {
          found: true,
          sections: [{
            title: 'Hallazgos',
            kind: 'conclusions',
            items: [{
              text: 'Se recetó una pomada el 3 de marzo.',
              citations: [{
                wiki_page: 'sources/informe-medico.md',
                raw_source: 'raw/informe-medico.pdf',
                locator: 'page 2',
                quote: 'Se recetó una pomada el 3 de marzo.',
              }],
            }],
          }],
        };
      }
      return {
        found: true,
        sections: [{
          title: 'Respuesta completa',
          kind: 'answer',
          items: [{
            text: 'La evidencia indica que la pomada se recetó el 3 de marzo.',
            evidence_ids: ['E1'],
          }],
        }],
      };
    },
  };

  const result = await generateComprehensiveAnswer('¿Qué se recetó?', documents, generator);

  assert.deepEqual(calls, ['grounded_evidence_findings', 'citation_preserving_synthesis']);
  assert.equal(result.found, true);
  assert.equal(result.claims.length, 1);
  assert.deepEqual(result.retrieval, {
    documents: 1,
    chunks: 1,
    batches: 1,
    failedBatches: 0,
    validatedFindings: 1,
    reductionFallback: false,
  });
});

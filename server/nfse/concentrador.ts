/**
 * Regras do POST /api/emitir (mesma ideia da fase 2 do concentrador do BMNFe), sem
 * banco nem Sefin, para o autoteste conferir: é a parte que, se errar, gera NFS-e duplicada.
 */

/**
 * O que fazer com uma referência que chegou de novo:
 * - nova: não existe, grava (reserva o número da DPS) e transmite;
 * - gerar: ainda não virou NFS-e, grava os dados de novo com o mesmo número e transmite;
 * - verificar: saiu sem resposta, pergunta à Sefin pela DPS antes de qualquer reenvio;
 * - devolver: já autorizada, só responde;
 * - usada: cancelada, a referência não serve mais.
 */
export type Acao = 'nova' | 'gerar' | 'verificar' | 'devolver' | 'usada';

export function decidir(situacao: string | undefined): Acao {
  switch (situacao) {
    case undefined:
      return 'nova';
    case 'assinada':
    case 'rejeitada':
      return 'gerar';
    case 'pendente':
      return 'verificar';
    case 'autorizada':
      return 'devolver';
    default:
      return 'usada';
  }
}

/** A referência do módulo de origem: até 80 caracteres, sem controle */
export function validarReferencia(valor: unknown): string {
  const ref = String(valor ?? '').trim();
  if (!ref || ref.length > 80 || /[\x00-\x1f]/.test(ref)) {
    throw new Error('Informe a referência da nota no módulo de origem (1 a 80 caracteres, ex.: VENDA-123).');
  }
  return ref;
}

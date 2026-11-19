/**
 * Concentrador de NFS-e: os módulos do ERP mandam a nota em JSON com uma referência
 * própria (ex.: VENDA-123) e o BMNFs grava, assina, transmite e responde. Mandar a mesma
 * referência de novo nunca gera outra NFS-e: devolve a que existe ou continua de onde parou.
 *
 *   POST /api/emitir              { referencia, documento }  documento = o mesmo corpo do POST /api/notas
 *   GET  /api/emitir/:referencia  situação, sem transmitir (pergunta à Sefin se ficou sem resposta)
 *
 * Enquanto uma chamada trabalha numa referência, ela segura um GET_LOCK do MySQL com o
 * nome da referência: a outra chamada com a mesma referência recebe 409 na hora. Se o
 * processo cair, o MySQL solta o lock junto com a conexão, e a nota fica "pendente" (a
 * próxima chamada pergunta à Sefin antes de reenviar).
 */
import crypto from 'crypto';
import { Router } from 'express';
import { pool } from '../db.js';
import { consultar, gravar, regravar, transmitir } from '../nfse/operacoes.js';
import { decidir, validarReferencia } from '../nfse/concentrador.js';
import { dataHoraMysql } from '../nfse/datas.js';
import { empresaDaRequisicao, rota } from './nfse.js';

async function buscar(empresaId: number, referencia: string): Promise<any | undefined> {
  try {
    const [linhas] = await pool.query<any[]>('SELECT * FROM nfs_notas WHERE empresa_id = ? AND referencia = ? LIMIT 1', [
      empresaId, referencia,
    ]);
    return linhas[0];
  } catch (err: any) {
    if (err?.code === 'ER_BAD_FIELD_ERROR') {
      throw new Error('Falta a coluna referencia em nfs_notas: rode a seção 8 do extras/2026-11-18_vendas_tabelas.sql do erp-vendas.');
    }
    throw err;
  }
}

function resposta(n: any, repetida = false) {
  return {
    success: true,
    referencia: n.referencia,
    situacao: n.situacao,
    ambiente: n.ambiente,
    serie: n.serie,
    numeroDps: Number(n.numero_dps),
    idDps: n.id_dps,
    chave: n.chave,
    numeroNfse: n.numero_nfse === null ? null : Number(n.numero_nfse),
    codigoStatus: n.codigo_status,
    motivo: n.motivo,
    /** XML da NFS-e quando autorizada ou cancelada */
    xml: n.xml_nfse,
    /** true quando nada foi transmitido nesta chamada: a nota já estava resolvida */
    repetida,
  };
}

/** Pergunta à Sefin pela DPS de uma nota que saiu sem resposta */
async function verificar(empresaId: number, notaId: number): Promise<'resolvida' | 'nao_consta' | 'pendente'> {
  try {
    await consultar(empresaId, notaId);
    return 'resolvida';
  } catch (err: any) {
    return err?.naoConsta ? 'nao_consta' : 'pendente';
  }
}

/** Roda `fn` segurando o lock da referência; ocupado = outra chamada está nela agora */
async function comTrava<T>(empresaId: number, referencia: string, fn: () => Promise<T>): Promise<T | 'ocupada'> {
  // O nome do lock tem no máximo 64 caracteres; a referência tem até 80
  const nome = `bmnfs:${crypto.createHash('sha1').update(`${empresaId}:${referencia}`).digest('hex')}`;
  const con = await pool.getConnection();
  try {
    const [[{ obtida }]] = await con.query<any[]>('SELECT GET_LOCK(?, 0) AS obtida', [nome]);
    if (Number(obtida) !== 1) return 'ocupada';
    try {
      return await fn();
    } finally {
      await con.query('SELECT RELEASE_LOCK(?)', [nome]).catch(() => {});
    }
  } finally {
    con.release();
  }
}

const OCUPADA = 'A nota desta referência está sendo processada agora. Consulte o resultado em instantes.';

export function criarRotasEmitir(): Router {
  const r = Router();

  r.post('/emitir', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const referencia = validarReferencia(req.body?.referencia);
    const documento = req.body?.documento;
    if (!documento || typeof documento !== 'object') throw new Error('Informe os dados da nota em documento.');

    const feito = await comTrava(empresaId, referencia, async () => {
      let n = await buscar(empresaId, referencia);
      let acao = decidir(n?.situacao);

      if (acao === 'verificar') {
        const v = await verificar(empresaId, n.id);
        n = await buscar(empresaId, referencia);
        if (v === 'pendente') return { status: 202, corpo: resposta(n, true) };
        if (v === 'resolvida') return { status: 200, corpo: resposta(n, true) };
        acao = 'gerar'; // não consta na Sefin: a DPS nunca chegou lá e pode ir de novo
        await pool.query(`UPDATE nfs_notas SET situacao = 'assinada', atualizado_em = ? WHERE id = ?`, [dataHoraMysql(), n.id]);
      }
      if (acao === 'devolver') return { status: 200, corpo: resposta(n, true) };
      if (acao === 'usada') {
        return {
          status: 409,
          corpo: { ...resposta(n, true), success: false, error: `A referência ${referencia} já foi usada na DPS ${n.numero_dps}, que está ${n.situacao}. Use outra referência.` },
        };
      }

      if (acao === 'nova') n = await gravar(empresaId, documento, referencia);
      else await regravar(empresaId, n.id, documento);

      try {
        await transmitir(empresaId, n.id);
      } catch (err: any) {
        // Sem resposta da Sefin a nota fica pendente (202); erro antes do envio (schema, dados) sobe
        n = await buscar(empresaId, referencia);
        if (n.situacao !== 'pendente') throw err;
        return { status: 202, corpo: resposta(n) };
      }
      return { status: 200, corpo: resposta(await buscar(empresaId, referencia)) };
    });

    if (feito === 'ocupada') return res.status(409).json({ success: false, referencia, error: OCUPADA });
    res.status(feito.status).json(feito.corpo);
  }));

  r.get('/emitir/:referencia', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const referencia = validarReferencia(req.params.referencia);
    let n = await buscar(empresaId, referencia);
    if (!n) return res.status(404).json({ success: false, error: `Nenhuma nota com a referência ${referencia}.` });

    if (n.situacao === 'pendente') {
      // Com a referência livre, pergunta à Sefin; ocupada, outra chamada já está nisso
      await comTrava(empresaId, referencia, async () => {
        if ((await verificar(empresaId, n.id)) === 'nao_consta') {
          await pool.query(`UPDATE nfs_notas SET situacao = 'assinada', motivo = ?, atualizado_em = ? WHERE id = ?`, [
            'A DPS não chegou à Sefin. Mande a mesma referência de novo.', dataHoraMysql(), n.id,
          ]);
        }
      });
      n = await buscar(empresaId, referencia);
    }
    res.status(n.situacao === 'pendente' ? 202 : 200).json(resposta(n));
  }));

  return r;
}

/**
 * Reúne o que toda operação com a Sefin Nacional precisa: configuração,
 * prestador e certificado. O certificado fica em cache na memória porque abrir
 * o PKCS#12 custa caro e ele só muda quando é trocado.
 */
import { pool } from '../db.js';
import { ConfigNFSe, lerConfig } from '../config.js';
import { carregarPfx, CertificadoCarregado } from './certificado.js';
import { dataHoraMysql } from './datas.js';

export interface Prestador {
  id: number;
  cnpj: string;
  inscricao_municipal: string | null;
  razao_social: string;
  nome_fantasia: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  codigo_municipio: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
  fone: string | null;
  email: string | null;
  /** 1=Não optante, 2=MEI, 3=ME/EPP */
  op_simples_nacional: number;
  regime_apuracao_sn: number | null;
  regime_especial: number;
}

export interface Contexto {
  empresaId: number;
  config: ConfigNFSe;
  prestador: Prestador;
  certificado: CertificadoCarregado;
}

/** Cache pela data de atualização: um certificado novo gravado no BM-Master vale na próxima operação */
const cacheCertificado = new Map<number, { atualizadoEm: string; cert: CertificadoCarregado }>();

/** Linha do certificado da empresa (sys_empresas_certificados, o mesmo da NF-e; gravado só no BM-Master) */
export async function linhaCertificado(empresaId: number): Promise<any | null> {
  const [linhas] = await pool.query<any[]>('SELECT * FROM sys_empresas_certificados WHERE empresa_id = ? LIMIT 1', [empresaId]);
  return linhas[0] ?? null;
}

export async function carregarCertificado(empresaId: number): Promise<CertificadoCarregado> {
  const linha = await linhaCertificado(empresaId);
  if (!linha) {
    throw new Error('Nenhum certificado digital cadastrado. Grave o arquivo .pfx no BM-Master (Grupos › Empresas › Configurações).');
  }

  const { arquivo, senha, atualizado_em } = linha;
  const emCache = cacheCertificado.get(empresaId);
  if (emCache && emCache.atualizadoEm === String(atualizado_em)) return emCache.cert;

  const cert = carregarPfx(Buffer.from(arquivo), senha);
  cacheCertificado.set(empresaId, { atualizadoEm: String(atualizado_em), cert });
  return cert;
}

export async function carregarPrestador(empresaId: number): Promise<Prestador> {
  const [linhas] = await pool.query<any[]>('SELECT * FROM nfs_empresas WHERE id = ? LIMIT 1', [empresaId]);
  if (!linhas.length) throw new Error('Prestador não encontrado.');
  return linhas[0] as Prestador;
}

export async function montarContexto(empresaId: number): Promise<Contexto> {
  const [config, prestador, certificado] = await Promise.all([
    lerConfig(empresaId),
    carregarPrestador(empresaId),
    carregarCertificado(empresaId),
  ]);

  if (certificado.info.diasParaVencer < 0) {
    throw new Error(`O certificado digital venceu em ${certificado.info.validoAte.toLocaleDateString('pt-BR')}.`);
  }
  if (!/^\d{7}$/.test(prestador.codigo_municipio || '')) {
    throw new Error('Informe o código IBGE do município do prestador em Configurações › Prestador.');
  }

  return { empresaId, config, prestador, certificado };
}

export interface RegistroLog {
  operacao: string;
  url?: string;
  chave?: string;
  sucesso: boolean;
  codigoStatus?: string;
  motivo?: string;
  duracaoMs?: number;
  envio?: string;
  retorno?: string;
}

export async function registrarLog(empresaId: number, reg: RegistroLog) {
  try {
    await pool.query(
      `INSERT INTO nfs_log
         (empresa_id, operacao, url, chave, sucesso, codigo_status, motivo, duracao_ms, envio, retorno, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId,
        reg.operacao,
        reg.url?.slice(0, 255) || null,
        reg.chave || null,
        reg.sucesso ? 1 : 0,
        reg.codigoStatus?.slice(0, 20) ?? null,
        reg.motivo?.slice(0, 255) || null,
        reg.duracaoMs ?? null,
        reg.envio || null,
        reg.retorno || null,
        dataHoraMysql(),
      ],
    );
  } catch (err) {
    // O log nunca pode derrubar a operação que ele está registrando
    console.warn('Falha ao gravar o log da operação:', err);
  }
}

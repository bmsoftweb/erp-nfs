-- =====================================================================
-- BMNFs — empresa_id das tabelas nfs_* passa a ser o sys_empresas.id
--
-- Para o erp-vendas (e qualquer módulo do ERP) falar com o BMNFs pela mesma
-- empresa que ele usa em todo o resto.
--
-- Como é hoje: o empresa_id gravado é o nfs_empresas.id. O login liga o
-- usuário (sys_usuarios) ao prestador pelo CNPJ: sys_empresas.cnpj = nfs_empresas.cnpj
-- (server/auth.ts, carregarUsuario). No bmerp_000000, em 18/11/2026, os dois ids
-- coincidem (só a empresa 1 tem prestador), mas nada garantia isso.
--
-- Como fica: nfs_empresas vira a extensão fiscal 1:1 da sys_empresas, com
-- id = sys_empresas.id (sem AUTO_INCREMENT). Ela continua existindo porque
-- guarda o que a sys_empresas não tem e a DPS exige: codigo_municipio (IBGE),
-- op_simples_nacional, regime_apuracao_sn e regime_especial. Toda tabela nfs_*
-- aponta para a sys_empresas. O código não muda: o JOIN por CNPJ do login (e o
-- do certificado emprestado do BMNFe) devolve o mesmo id.
--
-- Prestador novo, daqui em diante:
--   INSERT INTO nfs_empresas (id, cnpj, razao_social, ...) VALUES (<sys_empresas.id>, ...);
--
-- nfs_log não tem FK (o log nunca pode barrar a operação): só muda o tipo.
-- nfs_servicos_*, nfs_nbs* são tabelas de códigos, sem empresa: ficam fora.
-- =====================================================================

-- 1) ANTES de tudo. Tem de voltar vazia: cada prestador precisa da empresa do
--    ERP com o mesmo CNPJ e o MESMO id. Se voltar linha, pare: os ids terão de
--    ser remapeados caso a caso antes deste script.
SELECT s.id AS nfs_id, s.cnpj, se.id AS sys_id
  FROM nfs_empresas s
  LEFT JOIN sys_empresas se ON se.cnpj = s.cnpj COLLATE utf8mb4_unicode_ci
 WHERE se.id IS NULL OR se.id <> s.id;

-- 2) Solta as FKs para nfs_empresas (o tipo da coluna não muda com a FK presa)
ALTER TABLE nfs_config       DROP FOREIGN KEY fk_nfs_config_empresa;
ALTER TABLE nfs_certificados DROP FOREIGN KEY fk_nfs_certificados_empresa;
ALTER TABLE nfs_numeracao    DROP FOREIGN KEY fk_nfs_numeracao_empresa;
ALTER TABLE nfs_notas        DROP FOREIGN KEY fk_nfs_notas_empresa;
ALTER TABLE nfs_eventos      DROP FOREIGN KEY fk_nfs_eventos_empresa;

-- 3) Mesmo tipo do sys_empresas.id
ALTER TABLE nfs_empresas     MODIFY id         BIGINT UNSIGNED NOT NULL;
ALTER TABLE nfs_config       MODIFY empresa_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE nfs_certificados MODIFY empresa_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE nfs_numeracao    MODIFY empresa_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE nfs_notas        MODIFY empresa_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE nfs_eventos      MODIFY empresa_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE nfs_log          MODIFY empresa_id BIGINT UNSIGNED NOT NULL;

-- 4) FKs para sys_empresas (mesmos nomes de antes; a da nfs_empresas é nova)
ALTER TABLE nfs_empresas     ADD CONSTRAINT fk_nfs_empresas_sys         FOREIGN KEY (id)         REFERENCES sys_empresas (id);
ALTER TABLE nfs_config       ADD CONSTRAINT fk_nfs_config_empresa       FOREIGN KEY (empresa_id) REFERENCES sys_empresas (id);
ALTER TABLE nfs_certificados ADD CONSTRAINT fk_nfs_certificados_empresa FOREIGN KEY (empresa_id) REFERENCES sys_empresas (id);
ALTER TABLE nfs_numeracao    ADD CONSTRAINT fk_nfs_numeracao_empresa    FOREIGN KEY (empresa_id) REFERENCES sys_empresas (id);
ALTER TABLE nfs_notas        ADD CONSTRAINT fk_nfs_notas_empresa        FOREIGN KEY (empresa_id) REFERENCES sys_empresas (id);
ALTER TABLE nfs_eventos      ADD CONSTRAINT fk_nfs_eventos_empresa      FOREIGN KEY (empresa_id) REFERENCES sys_empresas (id);

-- =====================================================================
-- Reversão (volta para INT UNSIGNED com FK para nfs_empresas)
-- =====================================================================
-- ALTER TABLE nfs_empresas     DROP FOREIGN KEY fk_nfs_empresas_sys;
-- ALTER TABLE nfs_config       DROP FOREIGN KEY fk_nfs_config_empresa;
-- ALTER TABLE nfs_certificados DROP FOREIGN KEY fk_nfs_certificados_empresa;
-- ALTER TABLE nfs_numeracao    DROP FOREIGN KEY fk_nfs_numeracao_empresa;
-- ALTER TABLE nfs_notas        DROP FOREIGN KEY fk_nfs_notas_empresa;
-- ALTER TABLE nfs_eventos      DROP FOREIGN KEY fk_nfs_eventos_empresa;
--
-- ALTER TABLE nfs_empresas     MODIFY id         INT UNSIGNED NOT NULL AUTO_INCREMENT;
-- ALTER TABLE nfs_config       MODIFY empresa_id INT UNSIGNED NOT NULL;
-- ALTER TABLE nfs_certificados MODIFY empresa_id INT UNSIGNED NOT NULL;
-- ALTER TABLE nfs_numeracao    MODIFY empresa_id INT UNSIGNED NOT NULL;
-- ALTER TABLE nfs_notas        MODIFY empresa_id INT UNSIGNED NOT NULL;
-- ALTER TABLE nfs_eventos      MODIFY empresa_id INT UNSIGNED NOT NULL;
-- ALTER TABLE nfs_log          MODIFY empresa_id INT UNSIGNED NOT NULL;
--
-- ALTER TABLE nfs_config       ADD CONSTRAINT fk_nfs_config_empresa       FOREIGN KEY (empresa_id) REFERENCES nfs_empresas (id);
-- ALTER TABLE nfs_certificados ADD CONSTRAINT fk_nfs_certificados_empresa FOREIGN KEY (empresa_id) REFERENCES nfs_empresas (id);
-- ALTER TABLE nfs_numeracao    ADD CONSTRAINT fk_nfs_numeracao_empresa    FOREIGN KEY (empresa_id) REFERENCES nfs_empresas (id);
-- ALTER TABLE nfs_notas        ADD CONSTRAINT fk_nfs_notas_empresa        FOREIGN KEY (empresa_id) REFERENCES nfs_empresas (id);
-- ALTER TABLE nfs_eventos      ADD CONSTRAINT fk_nfs_eventos_empresa      FOREIGN KEY (empresa_id) REFERENCES nfs_empresas (id);

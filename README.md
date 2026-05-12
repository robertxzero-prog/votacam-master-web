# SaaS Master Local

Painel local (no seu computador) para controlar licenças e monitoramento das câmaras.

## Como executar

1. Abra terminal em `C:\sistema-votacao-camara\master-web`
2. Rode um servidor estático:
   - `python -m http.server 9090`
3. Abra no navegador:
   - `http://localhost:9090`

## Login inicial

- Usuário: `master`
- Senha: `camara@master`

> Trocar esse login por autenticação real no backend é obrigatório para produção.

## API esperada

O painel chama:

- `GET /configuracao/camaras`
- `PATCH /configuracao/camaras/upsert`
- `POST /configuracao/camaras/token`
- `POST /configuracao/monitor/heartbeat` (usado pelos clientes/câmaras)


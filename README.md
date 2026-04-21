# Super Air Hockey MVP

Projeto de air hockey com backend em Express + Socket.IO e frontend em React.

## Instalar dependencias

```bash
npm install
```

## Backend

```bash
npm run dev
```

Servidor padrao: `http://localhost:3001`

Sem build do frontend, essas rotas retornam uma mensagem orientando a usar o Vite ou gerar `dist/`.

## Frontend React em desenvolvimento

Em outra aba do terminal:

```bash
npm run client:dev
```

Frontend padrao: `http://localhost:5173`

O Vite faz proxy de `/socket.io` para o backend local, entao da para desenvolver a interface React sem mexer no servidor.

## Build do frontend

```bash
npm run build
```

Quando a pasta `dist/` existir, o Express passa a servir o app React em:

- `/`
- `/host`
- `/controller`
- `/host.html`
- `/controller.html`

Os arquivos HTML legados da pasta `public/` foram removidos. Agora o frontend vive apenas em `src/`.

## Acesso externo com Cloudflare Tunnel

Para expor o jogo fora da rede local, a opcao mais simples para desenvolvimento e um Quick Tunnel do `cloudflared`. A documentacao oficial da Cloudflare mostra esse fluxo com:

- `cloudflared tunnel --url http://localhost:8080`

No nosso caso, a porta da aplicacao e `3001`, entao o fluxo recomendado fica:

1. Subir o servidor em HTTP local:

```powershell
$env:DISABLE_HTTPS='1'
npm run dev
```

2. Em outro terminal, abrir o tunel:

```powershell
cloudflared tunnel --url http://localhost:3001
```

3. Copiar a URL `https://...trycloudflare.com` mostrada pelo `cloudflared`.

4. Reiniciar o backend com a URL publica configurada para o host gerar links corretos:

```powershell
$env:DISABLE_HTTPS='1'
$env:PUBLIC_APP_URL='https://SEU-TUNEL.trycloudflare.com'
npm run dev
```

Depois disso:

- host local: `http://localhost:3001/host`
- controller remoto: `https://SEU-TUNEL.trycloudflare.com/controller`

Observacoes:
- Quick Tunnels sao bons para teste, nao para producao.
- Como a URL publica do Cloudflare ja e HTTPS, os sensores no celular continuam em contexto seguro mesmo com a origem local em HTTP.
- Se preferir um tunel gerenciado por dominio proprio, a Cloudflare hoje recomenda um tunnel gerenciado/remotely-managed para a maioria dos casos.

## HTTPS local para sensores

```bash
npm run certs
```

Se o arquivo `certs/dev-cert.pfx` existir, o servidor sobe automaticamente em `https://localhost:3001`.

Arquivos gerados:
- `certs/dev-cert.pfx`
- `certs/dev-cert.cer`

Para o celular confiar no certificado, pode ser necessario importar `certs/dev-cert.cer` manualmente no aparelho.

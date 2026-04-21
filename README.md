# Super Air Hockey MVP (Local Network)

Implementação mínima funcional para validar:
- latência em rede local,
- controle por movimento no celular,
- sincronização multiplayer local com host na TV.

## Rodar localmente

```bash
npm install
npm start
```

Servidor padrão: `http://localhost:3000`

## Fluxo rápido
1. Abra `http://localhost:3000/host.html` na TV/desktop.
2. Use o link exibido para entrar pelo celular (`/controller.html?room=XXXXX`).
3. Permita sensores no celular (iOS pede consentimento explícito).
4. Mova o celular para controlar a raquete.

## Eventos Socket.IO (MVP)
- `host:create_room`
- `controller:join_room`
- `controller:move`
- `host:player_move`
- `host:goal`
- `game:score`

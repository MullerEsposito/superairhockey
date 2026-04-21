# Super Air Hockey — Estratégia de MVP (TV + Celulares)

## Objetivo do MVP
Validar rapidamente, em ambiente local (mesma rede Wi‑Fi), três hipóteses críticas:
1. **Latência**: input no celular refletindo na TV quase em tempo real.
2. **Controle por movimento**: celular como raquete é jogável.
3. **Sincronização multiplayer local**: 2+ jogadores com estado consistente.

## Escopo (o que entra e o que fica fora)

### Entra no MVP
- TV como tela principal/host da partida.
- Celulares como controles via navegador (PWA opcional).
- Entrada em sala por **QR Code**.
- Movimento lateral da raquete por sensores do celular.
- Física simples de puck + detecção de gol.

### Fica fora por enquanto
- Gráficos avançados e VFX.
- Física realista/perfeita.
- Matchmaking online / internet pública.
- Login, ranking, progressão.

---

## Arquitetura recomendada (simples e funcional)

### 1) TV (Host)
- App web em tela cheia (React + Phaser recomendado para 2D).
- Renderização do jogo.
- Simulação/física autoritativa (puck, colisões, gols).
- Recebe inputs dos celulares via WebSocket.

### 2) Celulares (Controles)
- Web app leve (React ou tela HTML minimalista).
- Captura `devicemotion` (aceleração e/ou rotação).
- Envia pacotes pequenos e frequentes para a sala.

### 3) Backend em rede local
- Node.js + Socket.IO.
- Responsável por:
  - criação/entrada em sala,
  - roteamento de input celular → host,
  - broadcast de estado (quando necessário).

---

## Fluxo de comunicação
1. TV cria sala (`roomId`) no servidor.
2. TV exibe QR Code com URL do controle + `roomId`.
3. Celular escaneia, abre página e entra na sala.
4. Celular envia eventos de movimento (`move`).
5. Host aplica input, atualiza física e renderiza frame.
6. (Opcional) Host/servidor envia estado resumido para celulares.

---

## Contrato mínimo de eventos (Socket.IO)

### Cliente Mobile → Servidor
- `join_room`: `{ roomId, playerName }`
- `move`: `{ roomId, playerId, ts, ax, ay }`
- `ready`: `{ roomId, playerId }`

### Servidor → TV (host)
- `player_joined`: `{ playerId }`
- `player_move`: `{ playerId, ts, ax, ay }`
- `player_left`: `{ playerId }`

### TV (host) → Servidor → Todos
- `game_state`: `{ puck, paddles, score, t }` (10–20 Hz já basta no MVP)
- `goal`: `{ side, score }`
- `match_status`: `{ phase }`

---

## Movimento do celular (versão 1)

```js
window.addEventListener('devicemotion', (event) => {
  const a = event.accelerationIncludingGravity;
  socket.emit('move', {
    roomId,
    playerId,
    ts: Date.now(),
    ax: a?.x ?? 0,
    ay: a?.y ?? 0,
  });
});
```

### Normalização inicial sugerida
- Filtrar ruído com média móvel curta (3–5 amostras).
- Mapear eixo dominante (`ax` ou `ay`) conforme orientação da tela.
- Clamp de faixa (ex.: `[-8, 8]`) antes de converter para velocidade.
- Deadzone (ex.: `|v| < 0.15 => 0`) para evitar drift.

---

## Física do MVP (sem complicar)
- Puck circular, raquetes circulares/retangulares simples.
- Velocidade linear + damping leve.
- Colisão básica (AABB/círculo) com reflexão.
- Sem rotação/spin inicialmente.
- Gol por interseção com zona de gol.

---

## Métricas de validação (essenciais)

### 1) Latência ponta a ponta
- Medir `input_ts` (mobile) e `apply_ts` (host).
- Meta inicial aceitável: **< 80 ms mediana** em rede local estável.

### 2) Estabilidade do controle
- Taxa de eventos processados por segundo.
- Jitter de input (desvio padrão).
- Feedback qualitativo: jogador sente “resposta imediata”.

### 3) Sincronização multiplayer
- Drift de estado entre frames (host vs clientes observadores).
- Quedas/reconexões sem travar partida.

---

## Plano de execução em 4 passos

### Passo 1 — Conectividade
- Subir servidor Socket.IO.
- TV cria sala + QR Code.
- Celular entra na sala e envia ping/move.

### Passo 2 — Input jogável
- Captura de `devicemotion`.
- Normalização + deadzone.
- Raquete se move de forma previsível.

### Passo 3 — Loop de jogo
- Física básica do puck.
- Colisão com bordas/raquetes.
- Gol + placar.

### Passo 4 — Hardening de MVP
- Reconexão simples.
- Ajustes de taxa de envio (20–40 Hz no mobile).
- Log de latência para validar hipótese.

---

## Riscos e mitigação rápida
- **Permissão de sensor no iOS**: pedir consentimento explícito na UI.
- **Diferença de sensores entre aparelhos**: calibrar ganho por dispositivo.
- **Wi‑Fi congestionado**: reduzir payload e frequência de eventos.
- **Jitter perceptível**: suavização no host + interpolação curta.

---

## Stack final recomendada para começar já
- **Host (TV):** React + Phaser.
- **Controle (Mobile):** Web app/PWA com DeviceMotion API + Socket.IO client.
- **Servidor local:** Node.js + Socket.IO.

Essa base é suficiente para validar jogabilidade real rapidamente, sem desperdiçar tempo com features não essenciais.

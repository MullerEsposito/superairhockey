import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import styles from './ControllerPage.module.css';

const TABLE_PADDING = 30;
const PADDLE_RADIUS = 36;
const PLAYER_LABEL_GAP = 12;
const TOUCH_HANDLE_RADIUS = 32;
const TOUCH_HANDLE_OFFSET = PADDLE_RADIUS + PLAYER_LABEL_GAP + 28;
const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 1280;
const DEFAULT_STATE = {
  matchStarted: false,
  paused: false,
  readyPlayers: 0,
  paddles: [],
  puck: {
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT / 2,
    r: 14,
  },
};

function clampForSide(side, x, y) {
  const minY = side === 'top' ? 40 : CANVAS_HEIGHT / 2 + 10;
  const maxY = side === 'top' ? CANVAS_HEIGHT / 2 - 10 : CANVAS_HEIGHT - 40;

  return {
    x: Math.max(40, Math.min(CANVAS_WIDTH - 40, x)),
    y: Math.max(minY, Math.min(maxY, y)),
  };
}

function toCanvasPoint(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = CANVAS_WIDTH / rect.width;
  const scaleY = CANVAS_HEIGHT / rect.height;

  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function getPlayerLabelY(paddle) {
  return paddle.side === 'top'
    ? paddle.y - paddle.radius - PLAYER_LABEL_GAP
    : paddle.y + paddle.radius + PLAYER_LABEL_GAP;
}

function getTouchHandleCenter(paddle) {
  const labelY = getPlayerLabelY(paddle);

  return {
    x: paddle.x,
    y: paddle.side === 'top' ? labelY - 28 : labelY + 28,
  };
}

export default function ControllerPage() {
  const queryRoom = new URLSearchParams(window.location.search).get('room');
  const socketRef = useRef(null);
  const joinedRoomRef = useRef(null);
  const playerSideRef = useRef(null);
  const canvasRef = useRef(null);
  const tableFrameRef = useRef(null);
  const activePointerIdRef = useRef(null);
  const dragConfigRef = useRef(null);
  const selectedRoomRef = useRef(queryRoom ? queryRoom.toUpperCase() : '');

  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(queryRoom ? queryRoom.toUpperCase() : '');
  const [playerName, setPlayerName] = useState('');
  const [desiredSide, setDesiredSide] = useState('bottom');
  const [status, setStatus] = useState('');
  const [statusOk, setStatusOk] = useState(true);
  const [joinedRoom, setJoinedRoom] = useState(null);
  const [playerSide, setPlayerSide] = useState(null);
  const [renderState, setRenderState] = useState(DEFAULT_STATE);
  const [menuOpen, setMenuOpen] = useState(false);
  const [touchMode, setTouchMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    selectedRoomRef.current = selectedRoom;
  }, [selectedRoom]);

  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)');
    const syncTouchMode = () => setTouchMode(media.matches);

    syncTouchMode();
    media.addEventListener?.('change', syncTouchMode);

    return () => {
      media.removeEventListener?.('change', syncTouchMode);
    };
  }, []);

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === tableFrameRef.current);
    };

    document.addEventListener('fullscreenchange', syncFullscreen);

    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
    };
  }, []);

  function setStatusMessage(message, ok = true) {
    setStatus(message);
    setStatusOk(ok);
  }

  function getScoreboardModel() {
    const topPlayer = renderState.paddles.find((paddle) => paddle.side === 'top');
    const bottomPlayer = renderState.paddles.find((paddle) => paddle.side === 'bottom');
    const prefersBottomFirst = playerSide !== 'top';
    const entries = prefersBottomFirst
      ? [
          {
            side: 'bottom',
            name: bottomPlayer?.playerName || 'Player 2',
            score: renderState.score?.bottom ?? 0,
            isSelf: playerSide === 'bottom',
          },
          {
            side: 'top',
            name: topPlayer?.playerName || 'Player 1',
            score: renderState.score?.top ?? 0,
            isSelf: playerSide === 'top',
          },
        ]
      : [
          {
            side: 'top',
            name: topPlayer?.playerName || 'Player 1',
            score: renderState.score?.top ?? 0,
            isSelf: playerSide === 'top',
          },
          {
            side: 'bottom',
            name: bottomPlayer?.playerName || 'Player 2',
            score: renderState.score?.bottom ?? 0,
            isSelf: playerSide === 'bottom',
          },
        ];

    return { entries };
  }

  function isTouchPointer(pointerType) {
    return pointerType === 'touch' || pointerType === 'pen';
  }

  function drawScene(state) {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.strokeStyle = '#5a6d9a';
    context.lineWidth = 4;
    context.strokeRect(TABLE_PADDING, TABLE_PADDING, CANVAS_WIDTH - 60, CANVAS_HEIGHT - 60);
    context.beginPath();
    context.moveTo(TABLE_PADDING, CANVAS_HEIGHT / 2);
    context.lineTo(CANVAS_WIDTH - TABLE_PADDING, CANVAS_HEIGHT / 2);
    context.stroke();

    for (const paddle of state.paddles || []) {
      const labelY = getPlayerLabelY(paddle);
      const touchHandle = getTouchHandleCenter(paddle);
      const showTouchHandle = touchMode && paddle.side === playerSide;

      context.beginPath();
      context.fillStyle = paddle.side === 'top' ? '#5eead4' : '#f472b6';
      context.arc(paddle.x, paddle.y, paddle.radius, 0, Math.PI * 2);
      context.fill();

      if (showTouchHandle) {
        context.beginPath();
        context.lineWidth = 3;
        context.strokeStyle = 'rgba(231, 236, 243, 0.35)';
        context.fillStyle = 'rgba(15, 23, 42, 0.16)';
        context.arc(touchHandle.x, touchHandle.y, TOUCH_HANDLE_RADIUS, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }

      context.fillStyle = '#e7ecf3';
      context.font = '24px Arial';
      context.textAlign = 'center';
      context.textBaseline = paddle.side === 'top' ? 'bottom' : 'top';
      context.fillText(paddle.playerName, paddle.x, labelY);
    }

    const puck = state.puck || DEFAULT_STATE.puck;
    context.beginPath();
    context.fillStyle = '#ffffff';
    context.arc(puck.x, puck.y, puck.r, 0, Math.PI * 2);
    context.fill();
  }

  useEffect(() => {
    drawScene(renderState);
  }, [joinedRoom, renderState]);

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('rooms:list');
    });

    socket.on('rooms:list', ({ rooms: nextRooms }) => {
      setRooms(nextRooms);
      if (!selectedRoomRef.current && queryRoom && nextRooms.some((room) => room.roomId === queryRoom.toUpperCase())) {
        setSelectedRoom(queryRoom.toUpperCase());
      }
    });

    socket.on('controller:joined', ({ roomId, side }) => {
      joinedRoomRef.current = roomId;
      playerSideRef.current = side;
      setJoinedRoom(roomId);
      setPlayerSide(side);
      setMenuOpen(false);
      setStatusMessage(`Conectado na sala ${roomId} (${side}).`, true);
    });

    socket.on('controller:error', ({ message }) => {
      setStatusMessage(message, false);
    });

    socket.on('game:state', ({ roomId, state }) => {
      if (joinedRoomRef.current && roomId !== joinedRoomRef.current) return;
      setRenderState(state || DEFAULT_STATE);
    });

    socket.on('game:ended', () => {
      joinedRoomRef.current = null;
      playerSideRef.current = null;
      activePointerIdRef.current = null;
      setJoinedRoom(null);
      setPlayerSide(null);
      setRenderState(DEFAULT_STATE);
      setMenuOpen(false);
      setStatusMessage('Host desconectou. Partida encerrada.', false);
      socket.emit('rooms:list');
    });

    return () => {
      socket.disconnect();
    };
  }, [queryRoom]);

  function emitTargetPosition(nextX, nextY) {
    if (!joinedRoomRef.current || !playerSideRef.current) return;

    const clamped = clampForSide(playerSideRef.current, nextX, nextY);
    socketRef.current?.emit('controller:move', {
      roomId: joinedRoomRef.current,
      x: clamped.x,
      y: clamped.y,
      ts: Date.now(),
    });
  }

  function handlePointerDown(event) {
    if (!joinedRoomRef.current) return;

    const ownPaddle = renderState.paddles.find((paddle) => paddle.side === playerSideRef.current);
    if (!ownPaddle) return;

    const point = toCanvasPoint(event.currentTarget, event.clientX, event.clientY);
    const touchHandle = getTouchHandleCenter(ownPaddle);
    const distanceFromHandle = Math.hypot(point.x - touchHandle.x, point.y - touchHandle.y);
    const touchPointer = isTouchPointer(event.pointerType);

    if (touchPointer && distanceFromHandle > TOUCH_HANDLE_RADIUS * 1.35) {
      return;
    }

    activePointerIdRef.current = event.pointerId;
    dragConfigRef.current = touchPointer
      ? {
          type: 'handle',
          pointerOffsetX: point.x - touchHandle.x,
          pointerOffsetY: point.y - touchHandle.y,
          handleOffsetX: touchHandle.x - ownPaddle.x,
          handleOffsetY: touchHandle.y - ownPaddle.y,
        }
      : {
          type: 'paddle',
        };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (touchPointer) {
      emitTargetPosition(
        point.x - dragConfigRef.current.pointerOffsetX - dragConfigRef.current.handleOffsetX,
        point.y - dragConfigRef.current.pointerOffsetY - dragConfigRef.current.handleOffsetY,
      );
      return;
    }

    emitTargetPosition(point.x, point.y);
  }

  function handlePointerMove(event) {
    if (!joinedRoomRef.current) return;

    const isMouse = event.pointerType === 'mouse';
    if (!isMouse && activePointerIdRef.current !== event.pointerId) {
      return;
    }

    const point = toCanvasPoint(event.currentTarget, event.clientX, event.clientY);
    const dragConfig = dragConfigRef.current;

    if (!isMouse && dragConfig?.type === 'handle') {
      emitTargetPosition(
        point.x - dragConfig.pointerOffsetX - dragConfig.handleOffsetX,
        point.y - dragConfig.pointerOffsetY - dragConfig.handleOffsetY,
      );
      return;
    }

    emitTargetPosition(point.x, point.y);
  }

  function handlePointerUp(event) {
    if (activePointerIdRef.current !== event.pointerId) return;
    activePointerIdRef.current = null;
    dragConfigRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function handleJoin() {
    const roomId = selectedRoom.trim().toUpperCase();
    if (!roomId) {
      setStatusMessage('Selecione uma sala.', false);
      return;
    }

    socketRef.current?.emit('controller:join_room', {
      roomId,
      playerName: playerName.trim() || 'Jogador',
      desiredSide,
    });
  }

  function handleLeave() {
    joinedRoomRef.current = null;
    playerSideRef.current = null;
    activePointerIdRef.current = null;
    dragConfigRef.current = null;
    setJoinedRoom(null);
    setPlayerSide(null);
    setRenderState(DEFAULT_STATE);
    setMenuOpen(false);
    setStatusMessage('Voce saiu da sala.', true);
    socketRef.current?.disconnect();
    socketRef.current?.connect();
  }

  function handleTogglePause() {
    if (!joinedRoomRef.current || !renderState.matchStarted) return;
    socketRef.current?.emit('controller:toggle_pause', {
      roomId: joinedRoomRef.current,
    });
  }

  async function handleToggleFullscreen() {
    const frame = tableFrameRef.current;
    if (!frame || !document.fullscreenEnabled) return;

    if (document.fullscreenElement === frame) {
      await document.exitFullscreen();
      return;
    }

    await frame.requestFullscreen();
  }

  const roomOptions = rooms.map((room) => {
    const sides = room.availableSides.length ? room.availableSides.join('/') : 'lotada';
    return {
      value: room.roomId,
      label: `${room.roomId} (${room.players} jogador(es), lados: ${sides})`,
    };
  });

  const scoreboard = getScoreboardModel();

  if (joinedRoom) {
    return (
      <main className={styles.shell}>
        <div className={styles.playShell}>
          <header className={styles.fixedHeader}>
            <div className={styles.headerCoreRow}>
              <div className={styles.scoreBoard}>
                <span
                  className={`${styles.scoreName} ${
                    scoreboard.entries[0].side === 'top' ? styles.scoreTop : styles.scoreBottom
                  } ${scoreboard.entries[0].isSelf ? styles.scoreSelf : ''}`}
                >
                  {scoreboard.entries[0].name}
                </span>
                <span className={styles.scoreValue}>{scoreboard.entries[0].score}</span>
                <span className={styles.scoreDivider}>x</span>
                <span className={styles.scoreValue}>{scoreboard.entries[1].score}</span>
                <span
                  className={`${styles.scoreName} ${
                    scoreboard.entries[1].side === 'top' ? styles.scoreTop : styles.scoreBottom
                  } ${scoreboard.entries[1].isSelf ? styles.scoreSelf : ''}`}
                >
                  {scoreboard.entries[1].name}
                </span>
              </div>
              <button
                className={`${styles.menuToggle} ${menuOpen ? styles.menuToggleOpen : ''}`}
                type="button"
                onClick={() => setMenuOpen((value) => !value)}
                aria-expanded={menuOpen}
                aria-label={menuOpen ? 'Recolher menu da partida' : 'Expandir menu da partida'}
              >
                <span className={styles.menuToggleGlyph}>{menuOpen ? 'x' : '+'}</span>
              </button>
            </div>
            <div className={`${styles.menuPanel} ${menuOpen ? styles.menuPanelOpen : styles.menuPanelClosed}`}>
              <div className={styles.headerMetaRow}>
                <div className={styles.roomChip}>Sala {joinedRoom}</div>
                {!renderState.matchStarted ? <div className={styles.roomChip}>Aguardando jogadores ({renderState.readyPlayers}/2)</div> : null}
              </div>
              <div className={styles.headerActions}>
                <button className={styles.secondaryButton} onClick={handleLeave} type="button">
                  Sair da sala
                </button>
              </div>
            </div>
          </header>

          <div className={styles.tableArea}>
            <div
              ref={tableFrameRef}
              className={`${styles.tableCanvasFrame} ${isFullscreen ? styles.tableCanvasFrameFullscreen : ''}`}
            >
              {isFullscreen ? (
                <button
                  className={styles.fullscreenExitButton}
                  type="button"
                  onClick={handleToggleFullscreen}
                  aria-label="Sair do modo tela cheia"
                  title="Sair do modo tela cheia"
                >
                  Sair da tela cheia
                </button>
              ) : null}
              <canvas
                ref={canvasRef}
                className={styles.tableCanvas}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              />
              {isFullscreen ? (
                <div className={`${styles.tableControls} ${styles.tableControlsFullscreen}`}>
                  <button
                    className={`${styles.pauseToggle} ${renderState.paused ? styles.pauseToggleActive : ''}`}
                    type="button"
                    onClick={handleTogglePause}
                    aria-label={renderState.paused ? 'Retomar partida' : 'Pausar partida'}
                    title={renderState.paused ? 'Retomar partida' : 'Pausar partida'}
                    disabled={!renderState.matchStarted}
                  >
                    <svg className={styles.controlIcon} viewBox="0 0 24 24" aria-hidden="true">
                      {renderState.paused ? (
                        <path d="M8 6.5v11l9-5.5-9-5.5Z" fill="currentColor" />
                      ) : (
                        <>
                          <rect x="6.5" y="5.5" width="4" height="13" rx="1.5" fill="currentColor" />
                          <rect x="13.5" y="5.5" width="4" height="13" rx="1.5" fill="currentColor" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              ) : null}
              {renderState.paused ? (
                <div className={styles.pauseBanner}>
                  <span className={styles.pauseBannerLabel}>Partida pausada</span>
                  <button className={styles.pauseBannerButton} type="button" onClick={handleTogglePause}>
                    Retomar partida
                  </button>
                </div>
              ) : null}
            </div>
            {!renderState.matchStarted ? (
              <p className={styles.helperCopy}>A partida comeca automaticamente quando os dois jogadores estiverem conectados.</p>
            ) : null}
            {!isFullscreen ? <div className={styles.tableControls}>
              <button
                className={`${styles.pauseToggle} ${renderState.paused ? styles.pauseToggleActive : ''}`}
                type="button"
                onClick={handleTogglePause}
                aria-label={renderState.paused ? 'Retomar partida' : 'Pausar partida'}
                title={renderState.paused ? 'Retomar partida' : 'Pausar partida'}
                disabled={!renderState.matchStarted}
              >
                <svg className={styles.controlIcon} viewBox="0 0 24 24" aria-hidden="true">
                  {renderState.paused ? (
                    <path d="M8 6.5v11l9-5.5-9-5.5Z" fill="currentColor" />
                  ) : (
                    <>
                      <rect x="6.5" y="5.5" width="4" height="13" rx="1.5" fill="currentColor" />
                      <rect x="13.5" y="5.5" width="4" height="13" rx="1.5" fill="currentColor" />
                    </>
                  )}
                </svg>
              </button>
              <button
                className={`${styles.fullscreenToggle} ${isFullscreen ? styles.fullscreenToggleActive : ''}`}
                type="button"
                onClick={handleToggleFullscreen}
                aria-label={isFullscreen ? 'Sair do modo tela cheia' : 'Entrar em modo tela cheia'}
                title={isFullscreen ? 'Sair do modo tela cheia' : 'Entrar em modo tela cheia'}
              >
                <svg className={styles.controlIcon} viewBox="0 0 24 24" aria-hidden="true">
                  {isFullscreen ? (
                    <path
                      d="M8 4H5v3M16 4h3v3M8 20H5v-3M19 17v3h-3M9 9 5 5M15 9l4-4M9 15l-4 4M15 15l4 4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : (
                    <path
                      d="M9 4H5v4M15 4h4v4M9 20H5v-4M19 20h-4v-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </svg>
              </button>
            </div> : null}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <section className={styles.card}>
        <h1 className={styles.title}>Controle</h1>
        <p className={styles.mutedCopy}>
          No computador use o mouse sobre a mesa. No celular, arraste o batedor com o dedo.
        </p>

        <label className={styles.fieldLabel} htmlFor="room">
          Sala
        </label>
        <select
          className={styles.field}
          id="room"
          value={selectedRoom}
          onChange={(event) => setSelectedRoom(event.target.value)}
        >
          <option value="">{roomOptions.length ? 'Selecione uma sala' : 'Nenhuma sala disponivel'}</option>
          {roomOptions.map((room) => (
            <option key={room.value} value={room.value}>
              {room.label}
            </option>
          ))}
        </select>

        <label className={styles.fieldLabel} htmlFor="name">
          Nome
        </label>
        <input
          className={styles.field}
          id="name"
          placeholder="Jogador"
          value={playerName}
          onChange={(event) => setPlayerName(event.target.value)}
        />

        <label className={styles.fieldLabel} htmlFor="side">
          Lado
        </label>
        <select
          className={styles.field}
          id="side"
          value={desiredSide}
          onChange={(event) => setDesiredSide(event.target.value)}
        >
          <option value="bottom">Bottom</option>
          <option value="top">Top</option>
        </select>

        <button className={styles.primaryButton} onClick={handleJoin} type="button">
          Entrar na mesa
        </button>
        {status ? <p className={statusOk ? styles.okCopy : styles.errCopy}>{status}</p> : null}
        <p className={styles.mutedCopy}>No computador use o mouse. No celular, arraste o batedor com o dedo.</p>
      </section>
    </main>
  );
}

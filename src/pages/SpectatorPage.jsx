import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import styles from './HostPage.module.css';

const TABLE_PADDING = 30;
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

export default function SpectatorPage() {
  const queryRoom = new URLSearchParams(window.location.search).get('room');
  const canvasRef = useRef(null);
  const socketRef = useRef(null);
  const selectedRoomRef = useRef(queryRoom ? queryRoom.toUpperCase() : '');
  const joinedRoomRef = useRef(null);
  const autoJoinAttemptedRef = useRef(false);

  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(queryRoom ? queryRoom.toUpperCase() : '');
  const [joinedRoom, setJoinedRoom] = useState(null);
  const [score, setScore] = useState({ top: 0, bottom: 0 });
  const [status, setStatus] = useState('Escolha uma sala para assistir.');
  const [statusOk, setStatusOk] = useState(true);
  const [renderState, setRenderState] = useState(DEFAULT_STATE);

  useEffect(() => {
    selectedRoomRef.current = selectedRoom;
  }, [selectedRoom]);

  useEffect(() => {
    joinedRoomRef.current = joinedRoom;
  }, [joinedRoom]);

  function setStatusMessage(message, ok = true) {
    setStatus(message);
    setStatusOk(ok);
  }

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('rooms:list');
    });

    socket.on('rooms:list', ({ rooms: nextRooms }) => {
      setRooms(nextRooms);
      if (
        !selectedRoomRef.current &&
        queryRoom &&
        nextRooms.some((room) => room.roomId === queryRoom.toUpperCase())
      ) {
        setSelectedRoom(queryRoom.toUpperCase());
      }

      if (
        queryRoom &&
        !joinedRoomRef.current &&
        !autoJoinAttemptedRef.current &&
        nextRooms.some((room) => room.roomId === queryRoom.toUpperCase())
      ) {
        autoJoinAttemptedRef.current = true;
        socket.emit('spectator:join_room', { roomId: queryRoom.toUpperCase() });
      }
    });

    socket.on('spectator:joined', ({ roomId, score: nextScore, gameState }) => {
      setJoinedRoom(roomId);
      setScore(nextScore || { top: 0, bottom: 0 });
      setRenderState(gameState || DEFAULT_STATE);
      setStatusMessage(`Assistindo a sala ${roomId}.`, true);
    });

    socket.on('spectator:error', ({ message }) => {
      setStatusMessage(message, false);
    });

    socket.on('game:state', ({ roomId, state, score: nextScore }) => {
      if (joinedRoomRef.current && roomId !== joinedRoomRef.current) return;
      setRenderState(state || DEFAULT_STATE);
      if (nextScore) {
        setScore(nextScore);
      }
    });

    socket.on('game:score', ({ score: nextScore }) => {
      setScore(nextScore);
    });

    socket.on('game:ended', () => {
      setJoinedRoom(null);
      setScore({ top: 0, bottom: 0 });
      setRenderState(DEFAULT_STATE);
      autoJoinAttemptedRef.current = false;
      setStatusMessage('A partida terminou porque o host saiu.', false);
      socket.emit('rooms:list');
    });

    return () => {
      socket.disconnect();
    };
  }, [queryRoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    function drawTable() {
      context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      context.strokeStyle = '#5a6d9a';
      context.lineWidth = 4;
      context.strokeRect(TABLE_PADDING, TABLE_PADDING, CANVAS_WIDTH - 60, CANVAS_HEIGHT - 60);
      context.beginPath();
      context.moveTo(TABLE_PADDING, CANVAS_HEIGHT / 2);
      context.lineTo(CANVAS_WIDTH - TABLE_PADDING, CANVAS_HEIGHT / 2);
      context.stroke();
    }

    function drawPaddles() {
      for (const paddle of renderState.paddles || []) {
        context.beginPath();
        context.fillStyle = paddle.side === 'top' ? '#5eead4' : '#f472b6';
        context.arc(paddle.x, paddle.y, paddle.radius, 0, Math.PI * 2);
        context.fill();

        context.fillStyle = '#e7ecf3';
        context.font = '24px Arial';
        context.textAlign = 'center';
        context.textBaseline = paddle.side === 'top' ? 'bottom' : 'top';
        context.fillText(
          paddle.playerName,
          paddle.x,
          paddle.side === 'top' ? paddle.y - paddle.radius - 12 : paddle.y + paddle.radius + 12,
        );
      }
    }

    function drawPuck() {
      const puck = renderState.puck || DEFAULT_STATE.puck;
      context.beginPath();
      context.fillStyle = '#ffffff';
      context.arc(puck.x, puck.y, puck.r, 0, Math.PI * 2);
      context.fill();
    }

    drawTable();
    drawPaddles();
    drawPuck();
  }, [renderState]);

  function handleJoin() {
    const roomId = selectedRoom.trim().toUpperCase();
    if (!roomId) {
      setStatusMessage('Selecione uma sala para assistir.', false);
      return;
    }

    autoJoinAttemptedRef.current = true;
    socketRef.current?.emit('spectator:join_room', { roomId });
  }

  const roomOptions = rooms.map((room) => ({
    value: room.roomId,
    label: `${room.roomId} (${room.players} jogador(es))`,
  }));

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.badge}>Sala: {joinedRoom || '---'}</div>
        <div className={styles.badge}>Placar: {score.top} x {score.bottom}</div>
        <div className={styles.badge}>
          {renderState.matchStarted
            ? renderState.paused
              ? 'Partida pausada'
              : 'Partida em andamento'
            : `Aguardando jogadores (${renderState.readyPlayers}/2)`}
        </div>
        <div className={styles.badge}>Modo: espectador</div>
        <p className={statusOk ? styles.joinUrl : styles.joinUrl}>{status}</p>
      </header>

      {!joinedRoom ? (
        <section className={styles.topbar}>
          <select
            className={styles.badge}
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
          <button className={styles.badge} onClick={handleJoin} type="button">
            Assistir partida
          </button>
        </section>
      ) : null}

      <canvas ref={canvasRef} className={styles.canvas} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
    </main>
  );
}

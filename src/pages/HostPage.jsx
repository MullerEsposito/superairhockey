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

export default function HostPage() {
  const canvasRef = useRef(null);
  const socketRef = useRef(null);
  const roomIdRef = useRef(null);
  const renderStateRef = useRef(DEFAULT_STATE);

  const [roomId, setRoomId] = useState('---');
  const [score, setScore] = useState({ top: 0, bottom: 0 });
  const [lastInput, setLastInput] = useState('---');
  const [joinUrl, setJoinUrl] = useState('');
  const [publicBaseUrl, setPublicBaseUrl] = useState('');
  const [spectatorUrl, setSpectatorUrl] = useState('');
  const [players, setPlayers] = useState(0);
  const [matchStarted, setMatchStarted] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function loadRuntimeConfig() {
      try {
        const response = await fetch('/api/runtime-config');
        if (!response.ok) return;

        const config = await response.json();
        if (!ignore) {
          setPublicBaseUrl(config.publicAppUrl || '');
        }
      } catch {
        if (!ignore) {
          setPublicBaseUrl('');
        }
      }
    }

    loadRuntimeConfig();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!roomIdRef.current) return;
    setJoinUrl(`${publicBaseUrl || window.location.origin}/controller?room=${roomIdRef.current}`);
    setSpectatorUrl(`${publicBaseUrl || window.location.origin}/spectator?room=${roomIdRef.current}`);
  }, [publicBaseUrl]);

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on('connect', () => {
      roomIdRef.current = null;
      renderStateRef.current = DEFAULT_STATE;
      setScore({ top: 0, bottom: 0 });
      setPlayers(0);
      setMatchStarted(false);
      setPaused(false);
      setLastInput('conectado');
      socket.emit('host:create_room');
    });

    socket.on('room:created', ({ roomId: nextRoomId }) => {
      roomIdRef.current = nextRoomId;
      setRoomId(nextRoomId);
      setJoinUrl(`${publicBaseUrl || window.location.origin}/controller?room=${nextRoomId}`);
      setSpectatorUrl(`${publicBaseUrl || window.location.origin}/spectator?room=${nextRoomId}`);
    });

    socket.on('host:player_joined', ({ side, playerName }) => {
      setLastInput(`${playerName} entrou (${side})`);
    });

    socket.on('host:player_move', ({ playerId, ax, ay }) => {
      setLastInput(`${playerId.slice(0, 4)} ax=${ax.toFixed(2)} ay=${ay.toFixed(2)}`);
    });

    socket.on('host:player_left', ({ playerId }) => {
      setLastInput(`${playerId.slice(0, 4)} saiu`);
    });

    socket.on('game:score', ({ score: nextScore }) => {
      setScore(nextScore);
    });

    socket.on('game:state', ({ state, score: nextScore }) => {
      renderStateRef.current = state || DEFAULT_STATE;
      setPlayers(state?.readyPlayers ?? (state?.paddles || []).length);
      setMatchStarted(Boolean(state?.matchStarted));
      setPaused(Boolean(state?.paused));
      if (nextScore) {
        setScore(nextScore);
      }
    });

    socket.on('disconnect', () => {
      setLastInput('desconectado');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    let frameId = 0;

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
      for (const paddle of renderStateRef.current.paddles || []) {
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
      const puck = renderStateRef.current.puck || DEFAULT_STATE.puck;
      context.beginPath();
      context.fillStyle = '#ffffff';
      context.arc(puck.x, puck.y, puck.r, 0, Math.PI * 2);
      context.fill();
    }

    function loop() {
      drawTable();
      drawPaddles();
      drawPuck();
      frameId = window.requestAnimationFrame(loop);
    }

    loop();

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.badge}>Sala: {roomId}</div>
        <div className={styles.badge}>Jogadores: {players}</div>
        <div className={styles.badge}>Placar: {score.top} x {score.bottom}</div>
        <div className={styles.badge}>
          {matchStarted ? (paused ? 'Partida pausada' : 'Partida em andamento') : 'Aguardando 2 jogadores'}
        </div>
        <div className={styles.badge}>Input: {lastInput}</div>
        <p className={styles.joinUrl}>{joinUrl}</p>
        <p className={styles.joinUrl}>{spectatorUrl}</p>
      </header>
      <canvas ref={canvasRef} className={styles.canvas} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
    </main>
  );
}

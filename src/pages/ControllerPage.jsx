import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import styles from './ControllerPage.module.css';

function normalizeForLandscape(ax, ay) {
  return { ax: ay, ay: -ax };
}

export default function ControllerPage() {
  const socketRef = useRef(null);
  const joinedRoomRef = useRef(null);
  const playerSideRef = useRef(null);
  const activeSensorSourceRef = useRef(null);
  const latestInputRef = useRef({ ax: 0, ay: 0, source: 'idle' });
  const emitIntervalRef = useRef(null);
  const queryRoom = new URLSearchParams(window.location.search).get('room');

  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(queryRoom ? queryRoom.toUpperCase() : '');
  const [playerName, setPlayerName] = useState('');
  const [desiredSide, setDesiredSide] = useState('bottom');
  const [status, setStatus] = useState('');
  const [statusOk, setStatusOk] = useState(true);
  const [debug, setDebug] = useState('Sensores ainda nao iniciados.');
  const [joinedRoom, setJoinedRoom] = useState(null);
  const [playerSide, setPlayerSide] = useState(null);
  const [invertYAxis, setInvertYAxis] = useState(false);
  const [sensitivity, setSensitivity] = useState(1);

  function setStatusMessage(message, ok = true) {
    setStatus(message);
    setStatusOk(ok);
  }

  function normalizeBySide(ax, ay, side, invertY) {
    const nextAy = invertY ? -ay : ay;
    if (side === 'top') {
      return { ax, ay: -nextAy };
    }
    return { ax, ay: nextAy };
  }

  function updateLatestInput(ax, ay, source) {
    latestInputRef.current = { ax, ay, source };
    setDebug(`Entrada: ${source} | ax=${ax.toFixed(2)} ay=${ay.toFixed(2)}`);
  }

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('rooms:list');
    });

    socket.on('rooms:list', ({ rooms: nextRooms }) => {
      setRooms(nextRooms);
      if (!selectedRoom && queryRoom && nextRooms.some((room) => room.roomId === queryRoom.toUpperCase())) {
        setSelectedRoom(queryRoom.toUpperCase());
      }
    });

    socket.on('controller:joined', ({ roomId, side }) => {
      joinedRoomRef.current = roomId;
      playerSideRef.current = side;
      activeSensorSourceRef.current = null;
      setJoinedRoom(roomId);
      setPlayerSide(side);
      setStatusMessage(`Conectado na sala ${roomId} (${side}).`, true);
    });

    socket.on('controller:error', ({ message }) => {
      setStatusMessage(message, false);
    });

    socket.on('game:ended', () => {
      joinedRoomRef.current = null;
      playerSideRef.current = null;
      activeSensorSourceRef.current = null;
      setJoinedRoom(null);
      setPlayerSide(null);
      setDebug('Partida encerrada. Entre novamente para continuar.');
      setStatusMessage('Host desconectou. Partida encerrada.', false);
      socket.emit('rooms:list');
    });

    return () => {
      socket.disconnect();
    };
  }, [queryRoom, selectedRoom]);

  useEffect(() => {
    function updateSensorInput(ax, ay, source) {
      if (!joinedRoomRef.current) return;

      const landscape = normalizeForLandscape(ax, ay);
      const normalized = normalizeBySide(landscape.ax, landscape.ay, playerSideRef.current, invertYAxis);
      const scaled = {
        ax: normalized.ax * sensitivity,
        ay: normalized.ay * sensitivity,
      };
      const hasMeaningfulInput = ax !== 0 || ay !== 0;

      if (activeSensorSourceRef.current && activeSensorSourceRef.current !== source) {
        return;
      }

      if (!activeSensorSourceRef.current && hasMeaningfulInput) {
        activeSensorSourceRef.current = source;
      }

      updateLatestInput(scaled.ax, scaled.ay, source);
    }

    function onMotion(event) {
      if (!joinedRoomRef.current) return;
      const acceleration = event.accelerationIncludingGravity || { x: 0, y: 0 };
      const deadzone = 0.12;
      const ax = Math.abs(acceleration.x) < deadzone ? 0 : acceleration.x;
      const ay = Math.abs(acceleration.y) < deadzone ? 0 : acceleration.y;
      updateSensorInput(ax, ay, 'devicemotion');
    }

    function onOrientation(event) {
      if (!joinedRoomRef.current) return;
      const gamma = Number.isFinite(event.gamma) ? event.gamma : 0;
      const beta = Number.isFinite(event.beta) ? event.beta : 0;
      const ax = Math.abs(gamma) < 2 ? 0 : gamma / 9;
      const ay = Math.abs(beta) < 2 ? 0 : beta / 12;
      updateSensorInput(ax, ay, 'deviceorientation');
    }

    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('deviceorientation', onOrientation);

    return () => {
      window.removeEventListener('devicemotion', onMotion);
      window.removeEventListener('deviceorientation', onOrientation);
    };
  }, [invertYAxis, sensitivity]);

  useEffect(() => {
    window.clearInterval(emitIntervalRef.current);
    emitIntervalRef.current = window.setInterval(() => {
      if (!joinedRoomRef.current) return;
      socketRef.current?.emit('controller:move', {
        roomId: joinedRoomRef.current,
        ts: Date.now(),
        ax: latestInputRef.current.ax,
        ay: latestInputRef.current.ay,
      });
    }, 50);

    return () => {
      window.clearInterval(emitIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (!window.isSecureContext) {
      setDebug('Sensores podem estar bloqueados: esta pagina foi aberta sem HTTPS.');
    }
  }, []);

  async function requestPermissionIfNeeded(EventType) {
    if (typeof EventType === 'undefined') return true;
    if (typeof EventType.requestPermission !== 'function') return true;

    try {
      const response = await EventType.requestPermission();
      return response === 'granted';
    } catch {
      return false;
    }
  }

  async function handleJoin() {
    const roomId = selectedRoom.trim().toUpperCase();
    if (!roomId) {
      setStatusMessage('Selecione uma sala.', false);
      return;
    }

    const motionPermission = await requestPermissionIfNeeded(window.DeviceMotionEvent);
    const orientationPermission = await requestPermissionIfNeeded(window.DeviceOrientationEvent);

    if (!motionPermission && !orientationPermission) {
      setStatusMessage('Permissao de movimento negada.', false);
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
    activeSensorSourceRef.current = null;
    latestInputRef.current = { ax: 0, ay: 0, source: 'idle' };
    setJoinedRoom(null);
    setPlayerSide(null);
    setDebug('Sensores ainda nao iniciados.');
    setStatusMessage('Voce saiu da sala.', true);
    socketRef.current?.disconnect();
    socketRef.current?.connect();
  }

  const roomOptions = rooms.map((room) => {
    const sides = room.availableSides.length ? room.availableSides.join('/') : 'lotada';
    return {
      value: room.roomId,
      label: `${room.roomId} (${room.players} jogador(es), lados: ${sides})`,
    };
  });

  if (joinedRoom) {
    return (
      <main className={styles.shell}>
        <div className={styles.gameShell}>
          <div className={styles.roomChip}>Sala {joinedRoom} | lado {playerSide}</div>
          <div className={styles.paddleStage}>
            <div className={styles.paddleDot} />
          </div>
          <div className={styles.sensitivityPanel}>
            <div className={styles.sensitivityHeader}>
              <span>Sensibilidade</span>
              <strong>{sensitivity.toFixed(1)}x</strong>
            </div>
            <input
              className={styles.sensitivitySlider}
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              value={sensitivity}
              onChange={(event) => setSensitivity(Number(event.target.value))}
            />
          </div>
          <button
            className={invertYAxis ? styles.toggleOn : styles.toggleOff}
            onClick={() => setInvertYAxis((value) => !value)}
          >
            Inverter eixo Y: {invertYAxis ? 'ligado' : 'desligado'}
          </button>
          <button className={styles.secondaryButton} onClick={handleLeave}>
            Sair da sala
          </button>
          <p className={styles.mutedCopy}>{debug}</p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <section className={styles.card}>
        <h1 className={styles.title}>Controle</h1>
        <p className={styles.mutedCopy}>O sensor e interpretado como se o celular estivesse na horizontal.</p>

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

        <button className={styles.primaryButton} onClick={handleJoin}>
          Entrar e iniciar sensores
        </button>
        {status ? <p className={statusOk ? styles.okCopy : styles.errCopy}>{status}</p> : null}
        <p className={styles.mutedCopy}>{debug}</p>
      </section>
    </main>
  );
}

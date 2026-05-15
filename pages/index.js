import { useCallback, useEffect, useRef, useState } from 'react';

const WIDTH = 960;
const HEIGHT = 540;
const WINNING_SCORE = 10;
const PADDLE_SPEED = 9;
const BALL_BOOST = 1.025;
const SPEED_LIMIT = 15;

const initialLeft = () => ({ x: 28, y: HEIGHT / 2 - 54, w: 14, h: 108, score: 0 });
const initialRight = () => ({ x: WIDTH - 42, y: HEIGHT / 2 - 54, w: 14, h: 108, score: 0 });
const initialBall = () => ({ x: WIDTH / 2, y: HEIGHT / 2, r: 9, vx: 6.2, vy: 3.2 });

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const randomRange = (a, b) => a + Math.random() * (b - a);

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

function makePlayerId() {
  return Math.random().toString(36).slice(2, 12);
}

function getStoredPlayerId() {
  const existing = window.localStorage.getItem('pingpong:playerId');
  if (existing) return existing;

  const nextPlayerId = makePlayerId();
  window.localStorage.setItem('pingpong:playerId', nextPlayerId);
  return nextPlayerId;
}

function getBadgeClass(status) {
  if (status.kind === 'ready') return 'badge badge-ready';
  if (status.kind === 'waiting') return 'badge badge-waiting';
  if (status.kind === 'error') return 'badge badge-error';
  return 'badge badge-connecting';
}

export default function Home() {
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const frameRef = useRef(null);
  const leftRef = useRef(initialLeft());
  const rightRef = useRef(initialRight());
  const ballRef = useRef(initialBall());
  const keysRef = useRef({ up: false, down: false });
  const roleRef = useRef(null);
  const myPadRef = useRef(null);
  const opponentConnectedRef = useRef(false);
  const runningRef = useRef(false);
  const gameOverRef = useRef(false);

  const [roomId, setRoomId] = useState('');
  const [scores, setScores] = useState({ left: 0, right: 0 });
  const [role, setRole] = useState(null);
  const [connectionKey, setConnectionKey] = useState(0);
  const [status, setStatus] = useState({ text: 'Connecting...', kind: 'connecting' });
  const [overlay, setOverlay] = useState({
    title: 'Connecting',
    line1: 'Connecting to the game server...',
    line2: 'The match will start when another player joins this room.',
    spinner: true,
  });

  const inviteUrl = roomId && typeof window !== 'undefined'
    ? `${window.location.origin}/?room=${roomId}`
    : '';

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const left = leftRef.current;
    const right = rightRef.current;
    const ball = ballRef.current;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    gradient.addColorStop(0, '#163056');
    gradient.addColorStop(1, '#07111f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 18]);
    ctx.beginPath();
    ctx.moveTo(WIDTH / 2, 16);
    ctx.lineTo(WIDTH / 2, HEIGHT - 16);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2;
    ctx.strokeRect(12, 12, WIDTH - 24, HEIGHT - 24);

    const drawPaddle = (pad, isLeft) => {
      const mine = roleRef.current === 'host' ? isLeft : !isLeft;
      ctx.shadowColor = isLeft ? 'rgba(112,211,255,0.7)' : 'rgba(255,120,120,0.55)';
      ctx.shadowBlur = mine ? 22 : 14;
      ctx.fillStyle = isLeft ? '#70d3ff' : '#ff7878';
      ctx.beginPath();
      ctx.roundRect(pad.x, pad.y, pad.w, pad.h, 8);
      ctx.fill();
      ctx.shadowBlur = 0;
    };

    drawPaddle(left, true);
    drawPaddle(right, false);

    ctx.shadowColor = 'rgba(255,255,255,0.75)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }, []);

  const sendMessage = useCallback((message) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }, []);

  const resetBall = useCallback((serveLeft = Math.random() > 0.5) => {
    const ball = ballRef.current;
    ball.x = WIDTH / 2;
    ball.y = HEIGHT / 2;
    ball.vx = 6.2 * (serveLeft ? -1 : 1);
    ball.vy = 6.2 * randomRange(-0.4, 0.4) + (Math.random() > 0.5 ? 1 : -1) * 2.2;
  }, []);

  const updateScoreState = useCallback(() => {
    setScores({
      left: leftRef.current.score,
      right: rightRef.current.score,
    });
  }, []);

  const applyInput = useCallback(() => {
    const pad = myPadRef.current;
    if (!pad) return;

    if (keysRef.current.up) pad.y -= PADDLE_SPEED;
    if (keysRef.current.down) pad.y += PADDLE_SPEED;
    pad.y = clamp(pad.y, 18, HEIGHT - pad.h - 18);
  }, []);

  const afterPoint = useCallback((leftWon) => {
    updateScoreState();

    if (leftRef.current.score >= WINNING_SCORE || rightRef.current.score >= WINNING_SCORE) {
      gameOverRef.current = true;
      runningRef.current = false;

      sendMessage({
        type: 'gameover',
        leftWon,
        ls: leftRef.current.score,
        rs: rightRef.current.score,
      });

      const iWon = roleRef.current === 'host' ? leftWon : !leftWon;
      setOverlay({
        title: iWon ? 'You Win!' : 'You Lose',
        line1: `Final score: ${leftRef.current.score} : ${rightRef.current.score}`,
        line2: 'Press Reset to play again.',
      });
      return;
    }

    resetBall(!leftWon);
  }, [resetBall, sendMessage, updateScoreState]);

  const updateBall = useCallback(() => {
    const ball = ballRef.current;
    const left = leftRef.current;
    const right = rightRef.current;

    ball.x += ball.vx;
    ball.y += ball.vy;

    if (ball.y - ball.r <= 16) {
      ball.y = 16 + ball.r;
      ball.vy *= -1;
    }

    if (ball.y + ball.r >= HEIGHT - 16) {
      ball.y = HEIGHT - 16 - ball.r;
      ball.vy *= -1;
    }

    const collides = (pad) => (
      ball.x - ball.r < pad.x + pad.w
      && ball.x + ball.r > pad.x
      && ball.y + ball.r > pad.y
      && ball.y - ball.r < pad.y + pad.h
    );

    const handleHit = (pad, goRight) => {
      const rel = (ball.y - (pad.y + pad.h / 2)) / (pad.h / 2);
      ball.vx = Math.abs(ball.vx) * BALL_BOOST * (goRight ? 1 : -1);
      ball.vy = rel * 7.8;
      ball.vx = clamp(ball.vx, -SPEED_LIMIT, SPEED_LIMIT);
      ball.vy = clamp(ball.vy, -SPEED_LIMIT, SPEED_LIMIT);
    };

    if (collides(left) && ball.vx < 0) {
      ball.x = left.x + left.w + ball.r;
      handleHit(left, true);
    }

    if (collides(right) && ball.vx > 0) {
      ball.x = right.x - ball.r;
      handleHit(right, false);
    }

    if (ball.x < -30) {
      right.score += 1;
      afterPoint(false);
    }

    if (ball.x > WIDTH + 30) {
      left.score += 1;
      afterPoint(true);
    }
  }, [afterPoint]);

  const hostLoop = useCallback(() => {
    if (!runningRef.current) return;

    applyInput();
    updateBall();
    draw();

    const left = leftRef.current;
    const right = rightRef.current;
    const ball = ballRef.current;
    sendMessage({
      type: 'state',
      lx: left.x,
      ly: left.y,
      rx: right.x,
      ry: right.y,
      bx: ball.x,
      by: ball.y,
      bvx: ball.vx,
      bvy: ball.vy,
      ls: left.score,
      rs: right.score,
    });

    frameRef.current = requestAnimationFrame(hostLoop);
  }, [applyInput, draw, sendMessage, updateBall]);

  const guestLoop = useCallback(() => {
    applyInput();

    if (runningRef.current && myPadRef.current) {
      sendMessage({ type: 'paddleY', y: myPadRef.current.y });
    }

    draw();
    frameRef.current = requestAnimationFrame(guestLoop);
  }, [applyInput, draw, sendMessage]);

  const startGame = useCallback(() => {
    if (roleRef.current !== 'host' || !opponentConnectedRef.current || gameOverRef.current) return;

    runningRef.current = true;
    setOverlay(null);
    sendMessage({ type: 'start' });
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(hostLoop);
  }, [hostLoop, sendMessage]);

  const pauseGame = useCallback(() => {
    if (roleRef.current !== 'host') return;

    runningRef.current = !runningRef.current;

    if (runningRef.current) {
      setOverlay(null);
      sendMessage({ type: 'resume' });
      frameRef.current = requestAnimationFrame(hostLoop);
    } else {
      setOverlay({ title: 'Paused', line1: 'Press Space or Start to resume.' });
      sendMessage({ type: 'pause' });
    }
  }, [hostLoop, sendMessage]);

  const resetGame = useCallback(() => {
    if (roleRef.current !== 'host') return;

    leftRef.current = initialLeft();
    rightRef.current = initialRight();
    myPadRef.current = leftRef.current;
    ballRef.current = initialBall();
    gameOverRef.current = false;
    runningRef.current = false;
    resetBall(false);
    updateScoreState();
    sendMessage({ type: 'reset' });
    setOverlay({ title: 'Game Reset', line1: 'Press Start to play again.' });
    draw();
  }, [draw, resetBall, sendMessage, updateScoreState]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let nextRoomId = params.get('room');

    if (!nextRoomId) {
      nextRoomId = makeRoomId();
      params.set('room', nextRoomId);
      window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    }

    setRoomId(nextRoomId);
    const playerId = getStoredPlayerId();

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const currentHost = window.location.host;
    const alternateHost = window.location.hostname === 'localhost'
      ? currentHost.replace('localhost', '127.0.0.1')
      : window.location.hostname === '127.0.0.1'
        ? currentHost.replace('127.0.0.1', 'localhost')
        : null;
    const hosts = [currentHost, alternateHost].filter(Boolean);
    let closedByCleanup = false;
    let roomAssigned = false;
    let connectTimer = null;

    const showConnectionFailed = () => {
      setStatus({ text: 'Connection failed', kind: 'error' });
      setOverlay({
        title: 'Connection Failed',
        line1: 'The page loaded, but the game socket did not connect.',
        line2: 'Restart npm run dev, then press Retry.',
      });
    };

    const attachHandlers = (ws, host, hostIndex) => {
      wsRef.current = ws;

      clearTimeout(connectTimer);
      connectTimer = setTimeout(() => {
        if (!roomAssigned && ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      }, 3000);

      ws.onopen = () => {
        clearTimeout(connectTimer);
      setStatus({ text: 'Connected', kind: 'ready' });
      setOverlay({
        title: 'Waiting...',
        line1: 'Waiting for another player to join this room.',
          line2: `Connected through ${host}. Share the invite link from the top bar.`,
        spinner: true,
      });
      };

      ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'role') {
        roomAssigned = true;
        window.localStorage.setItem('pingpong:playerId', msg.playerId);
        roleRef.current = msg.role;
        setRole(msg.role);
        setRoomId(msg.roomId);
        opponentConnectedRef.current = msg.opponentPresent;

        if (msg.role === 'host') {
          myPadRef.current = leftRef.current;
          setStatus(msg.opponentPresent
            ? { text: 'Ready', kind: 'ready' }
            : { text: 'Waiting...', kind: 'waiting' });
          setOverlay(msg.opponentPresent
            ? {
                title: 'Reconnected',
                line1: 'You are Player 1 on the left paddle.',
                line2: 'Press Start when ready.',
              }
            : {
                title: 'Waiting for Opponent...',
                line1: 'You are Player 1 on the left paddle.',
                line2: 'Share your invite link with a friend.',
                spinner: true,
              });
        } else {
          myPadRef.current = rightRef.current;
          setStatus({ text: 'Ready, waiting for host', kind: 'ready' });
          setOverlay({
            title: 'Game Found!',
            line1: 'You are Player 2 on the right paddle.',
            line2: 'Waiting for Player 1 to start the game.',
          });
          cancelAnimationFrame(frameRef.current);
          frameRef.current = requestAnimationFrame(guestLoop);
        }
      }

      if (msg.type === 'guestJoined' && roleRef.current === 'host') {
        opponentConnectedRef.current = true;
        setStatus({ text: 'Ready', kind: 'ready' });
        setOverlay({
          title: 'Opponent Connected!',
          line1: 'You are Player 1 on the left paddle.',
          line2: 'Press Start when ready.',
        });
      }

      if (msg.type === 'paddleY' && roleRef.current === 'host') {
        rightRef.current.y = clamp(msg.y, 18, HEIGHT - rightRef.current.h - 18);
      }

      if (msg.type === 'state' && roleRef.current === 'guest') {
        leftRef.current.y = msg.ly;
        ballRef.current.x = msg.bx;
        ballRef.current.y = msg.by;
        ballRef.current.vx = msg.bvx;
        ballRef.current.vy = msg.bvy;
        leftRef.current.score = msg.ls;
        rightRef.current.score = msg.rs;
        updateScoreState();

        if (!runningRef.current) {
          runningRef.current = true;
          setOverlay(null);
          cancelAnimationFrame(frameRef.current);
          frameRef.current = requestAnimationFrame(guestLoop);
        }
      }

      if (msg.type === 'start' && roleRef.current === 'guest') {
        runningRef.current = true;
        gameOverRef.current = false;
        setOverlay(null);
        cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(guestLoop);
      }

      if (msg.type === 'pause' && roleRef.current === 'guest') {
        runningRef.current = false;
        setOverlay({ title: 'Paused', line1: 'Player 1 paused the game.', line2: 'Waiting to resume...' });
      }

      if (msg.type === 'resume' && roleRef.current === 'guest') {
        runningRef.current = true;
        setOverlay(null);
      }

      if (msg.type === 'reset' && roleRef.current === 'guest') {
        leftRef.current = initialLeft();
        rightRef.current = initialRight();
        myPadRef.current = rightRef.current;
        ballRef.current = initialBall();
        gameOverRef.current = false;
        runningRef.current = false;
        resetBall(false);
        updateScoreState();
        setOverlay({ title: 'Game Reset', line1: 'Waiting for Player 1 to start...' });
        draw();
      }

      if (msg.type === 'gameover' && roleRef.current === 'guest') {
        runningRef.current = false;
        gameOverRef.current = true;
        leftRef.current.score = msg.ls;
        rightRef.current.score = msg.rs;
        updateScoreState();
        setOverlay({
          title: msg.leftWon ? 'You Lose' : 'You Win!',
          line1: `Final score: ${msg.ls} : ${msg.rs}`,
          line2: 'Waiting for Player 1 to reset.',
        });
      }

      if (msg.type === 'opponentDisconnected') {
        runningRef.current = false;
        opponentConnectedRef.current = false;
        setStatus({ text: 'Opponent reconnecting', kind: 'waiting' });
        setOverlay({
          title: 'Opponent Reconnecting...',
          line1: 'Their page closed or refreshed.',
          line2: `Keeping their seat for ${Math.round(msg.graceMs / 1000)} seconds.`,
          spinner: true,
        });
      }

      if (msg.type === 'opponentReconnected') {
        opponentConnectedRef.current = true;
        setStatus({ text: 'Ready', kind: 'ready' });
        setOverlay({
          title: 'Opponent Reconnected',
          line1: roleRef.current === 'host'
            ? 'Press Start when ready.'
            : 'Waiting for Player 1 to start.',
        });
      }

      if (msg.type === 'opponentLeft') {
        runningRef.current = false;
        opponentConnectedRef.current = false;
        setStatus({ text: 'Disconnected', kind: 'error' });
        setOverlay({
          title: 'Opponent Left',
          line1: 'The other player disconnected.',
          line2: 'Refresh the page to create or join a fresh room.',
        });
      }

      if (msg.type === 'roomFull') {
        roomAssigned = true;
        setStatus({ text: 'Room full', kind: 'error' });
        setOverlay({
          title: 'Room Full',
          line1: 'This invite already has two players.',
          line2: 'Open a new room URL to start another match.',
        });
      }
      };

      ws.onerror = () => {
        clearTimeout(connectTimer);
      };

      ws.onclose = () => {
        clearTimeout(connectTimer);

        if (closedByCleanup) return;

        if (!roomAssigned && hosts[hostIndex + 1]) {
          openSocket(hostIndex + 1);
          return;
        }

        if (!roomAssigned) {
          showConnectionFailed();
          return;
        }

        if (!opponentConnectedRef.current) {
        setStatus({ text: 'Offline', kind: 'error' });
      }
      };
    };

    const openSocket = (hostIndex = 0) => {
      const host = hosts[hostIndex];
      setStatus({ text: 'Connecting...', kind: 'connecting' });
      setOverlay({
        title: 'Connecting',
        line1: `Trying ${protocol}://${host}/ws`,
        line2: hostIndex > 0 ? 'Trying the local fallback address.' : 'Setting up the game room.',
        spinner: true,
      });
      attachHandlers(new WebSocket(`${protocol}://${host}/ws?room=${nextRoomId}&player=${playerId}`), host, hostIndex);
    };

    openSocket();

    return () => {
      closedByCleanup = true;
      clearTimeout(connectTimer);
      cancelAnimationFrame(frameRef.current);
      wsRef.current?.close();
    };
  }, [connectionKey, draw, guestLoop, resetBall, updateScoreState]);

  useEffect(() => {
    const pointerY = (clientY) => {
      const rect = canvasRef.current.getBoundingClientRect();
      return (clientY - rect.top) * (HEIGHT / rect.height);
    };

    const handleMouseMove = (event) => {
      const pad = myPadRef.current;
      if (!pad || !canvasRef.current) return;
      pad.y = clamp(pointerY(event.clientY) - pad.h / 2, 18, HEIGHT - pad.h - 18);
    };

    const handleTouchMove = (event) => {
      const pad = myPadRef.current;
      if (!pad || !canvasRef.current) return;
      event.preventDefault();
      pad.y = clamp(pointerY(event.touches[0].clientY) - pad.h / 2, 18, HEIGHT - pad.h - 18);
    };

    const handleKeyDown = (event) => {
      const key = event.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') {
        keysRef.current.up = true;
        event.preventDefault();
      }
      if (key === 's' || key === 'arrowdown') {
        keysRef.current.down = true;
        event.preventDefault();
      }
      if (key === ' ') {
        event.preventDefault();
        runningRef.current ? pauseGame() : startGame();
      }
      if (key === 'r' && roleRef.current === 'host') {
        resetGame();
      }
    };

    const handleKeyUp = (event) => {
      const key = event.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') keysRef.current.up = false;
      if (key === 's' || key === 'arrowdown') keysRef.current.down = false;
    };

    const canvas = canvasRef.current;
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [pauseGame, resetGame, startGame]);

  const copyInvite = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setStatus({ text: 'Invite copied', kind: 'ready' });
  };

  const retryConnection = () => {
    roleRef.current = null;
    myPadRef.current = null;
    opponentConnectedRef.current = false;
    runningRef.current = false;
    gameOverRef.current = false;
    wsRef.current?.close();
    setRole(null);
    setConnectionKey((value) => value + 1);
  };

  const canHostControl = role === 'host' && opponentConnectedRef.current;

  return (
    <main className="game-shell">
      <section className="top-bar" aria-label="Game controls">
        <div className="title">Ping Pong</div>
        <div className="scoreboard" aria-live="polite">
          <div className="score-box">
            <span className="score-label">{role === 'host' ? 'You (P1)' : 'Opponent'}</span>
            <span>{scores.left}</span>
          </div>
          <span>:</span>
          <div className="score-box">
            <span className="score-label">{role === 'guest' ? 'You (P2)' : 'Opponent'}</span>
            <span>{scores.right}</span>
          </div>
        </div>
        <div className="controls">
          {role && (
            <span className={`badge ${role === 'host' ? 'badge-p1' : 'badge-p2'}`}>
              {role === 'host' ? 'Player 1 Left' : 'Player 2 Right'}
            </span>
          )}
          <span className={getBadgeClass(status)}>{status.text}</span>
          <button type="button" onClick={copyInvite} disabled={!inviteUrl}>Copy Invite</button>
          <button type="button" onClick={retryConnection}>Retry</button>
          <button type="button" onClick={startGame} disabled={!canHostControl}>Start</button>
          <button type="button" onClick={pauseGame} disabled={!canHostControl}>Pause</button>
          <button type="button" onClick={resetGame} disabled={!canHostControl}>Reset</button>
        </div>
      </section>

      <section className="invite-row" aria-label="Invite link">
        <span>Room {roomId || '...'}</span>
        <input value={inviteUrl} readOnly aria-label="Invite URL" />
      </section>

      <section className="canvas-wrap">
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} aria-label="Ping pong game canvas" />
        {overlay && (
          <div className="overlay">
            <div className="message">
              <h1>{overlay.spinner && <span className="spin" />}{overlay.title}</h1>
              <p>{overlay.line1}</p>
              {overlay.line2 && <p>{overlay.line2}</p>}
            </div>
          </div>
        )}
      </section>

      <div className="help">
        Mouse / touch to move | W/S or arrow keys | Space start/pause | R reset for host
      </div>
    </main>
  );
}

// Sesli sohbet: WebRTC ile herkes herkese bağlanır (en fazla 11 bağlantı, sadece ses).
// Kurallar: sadece toplantıda, sadece hayattaysan Space (ya da telefonda düğme) basılıyken konuşursun.
// Düşenler dinler ama konuşamaz. Dinleyen taraf da sadece hayattaki oyuncuların sesini toplantıda çalar.
window.Voice = (() => {
  'use strict';
  let socket = null, getState = () => null, onChange = () => {}, onHint = () => {};
  let enabled = false, starting = false, stream = null, track = null, ice = null;
  let ptt = false, sentTalk = false;
  const peers = new Map();
  const talking = new Set();

  const S = () => getState();
  const me = () => { const s = S(); return s && s.players.find(p => p.id === s.meId); };
  const player = id => { const s = S(); return s && s.players.find(p => p.id === id); };
  const inGame = () => { const s = S(); return !!s && s.phase !== 'lobby'; };
  function canTalk(){ const s = S(), m = me(); return !!(s && m && s.phase === 'meeting' && m.alive); }
  function canHear(id){ const s = S(), p = player(id); return !!(s && p && s.phase === 'meeting' && p.alive); }

  function init(sock, stateFn, changeFn, hintFn){
    socket = sock; getState = stateFn; onChange = changeFn || onChange; onHint = hintFn || onHint;
    socket.on('rtc:signal', onSignal);
    socket.on('voice:talk', ({ id, on }) => { if (on) talking.add(id); else talking.delete(id); onChange(); });
    socket.on('connect', () => { if (enabled) socket.emit('voice:on', { on: true }); });
    document.addEventListener('keydown', e => {
      // butona odak kalsa bile Space bas-konuş olarak çalışır; yazı alanlarında normal boşluktur
      if (e.code !== 'Space' || e.target.closest('input,textarea,select,[contenteditable]') || !inGame()) return;
      e.preventDefault(); if (e.repeat) return;
      if (!enabled) return onHint('Konuşmak için önce "Sesli sohbete katıl" düğmesine bas.');
      setPtt(true);
    });
    document.addEventListener('keyup', e => {
      if (e.code !== 'Space' || e.target.closest('input,textarea,select,[contenteditable]') || !inGame()) return;
      e.preventDefault(); setPtt(false);
    });
    window.addEventListener('blur', () => setPtt(false));
  }

  async function enable(){
    if (enabled || starting) return;
    starting = true;
    try {
      if (!ice) ice = await fetch('ice.json').then(r => r.json()).catch(() => [{ urls: 'stun:stun.l.google.com:19302' }]);
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      track = stream.getAudioTracks()[0];
      track.enabled = false;
      enabled = true;
      socket.emit('voice:on', { on: true });
      sync();
    } finally { starting = false; onChange(); }
  }

  function disable(){
    enabled = false; ptt = false;
    for (const id of [...peers.keys()]) closePeer(id);
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; track = null;
    if (sentTalk){ sentTalk = false; socket.emit('voice:talk', { on: false }); }
    socket.emit('voice:on', { on: false });
    onChange();
  }

  // Her durum güncellemesinde çağrılır: bağlantıları ve kapıları günceller
  function sync(){
    const s = S();
    if (!s || s.phase !== 'meeting') talking.clear();
    if (!enabled) return;
    if (!inGame()){ for (const id of [...peers.keys()]) closePeer(id); return gate(); }
    const want = new Set(s.players.filter(p => p.id !== s.meId && p.voice && p.connected && !p.isBot).map(p => p.id));
    for (const id of want) if (!peers.has(id)) createPeer(id);
    for (const id of [...peers.keys()]) if (!want.has(id)) closePeer(id);
    gate();
  }

  function gate(){
    const talk = enabled && ptt && canTalk();
    if (track) track.enabled = talk;
    if (talk !== sentTalk){ sentTalk = talk; socket.emit('voice:talk', { on: talk }); }
    for (const [id, p] of peers) p.audio.muted = !canHear(id);
  }

  function setPtt(on){
    if (ptt === on) return;
    ptt = on;
    gate(); onChange();
  }

  function createPeer(id){
    const s = S();
    const pc = new RTCPeerConnection({ iceServers: ice || [] });
    const audio = new Audio(); audio.autoplay = true; audio.muted = true; audio.hidden = true; document.body.appendChild(audio);
    // "perfect negotiation": iki taraf aynı anda teklif gönderirse kibar olan geri çekilir
    const peer = { pc, audio, polite: s.meId > id, makingOffer: false, ignoreOffer: false };
    peers.set(id, peer);
    pc.addTrack(track, stream);
    pc.onnegotiationneeded = async () => {
      try { peer.makingOffer = true; await pc.setLocalDescription(); socket.emit('rtc:signal', { to: id, data: { description: pc.localDescription } }); }
      catch (e) { console.warn('ses teklifi', e); }
      finally { peer.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) socket.emit('rtc:signal', { to: id, data: { candidate } }); };
    pc.ontrack = ({ streams }) => { audio.srcObject = streams[0]; audio.play().catch(() => {}); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') pc.restartIce(); onChange(); };
    gate();
    return peer;
  }

  function closePeer(id){
    const p = peers.get(id); if (!p) return;
    p.pc.close(); p.audio.srcObject = null; p.audio.remove();
    peers.delete(id);
  }

  async function onSignal({ from, data }){
    if (!enabled || !data) return;
    const sender = player(from);
    if (!sender || !sender.voice) return;
    const peer = peers.get(from) || createPeer(from);
    const { pc } = peer;
    try {
      if (data.description){
        const collision = data.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer'){
          await pc.setLocalDescription();
          socket.emit('rtc:signal', { to: from, data: { description: pc.localDescription } });
        }
      } else if (data.candidate){
        try { await pc.addIceCandidate(data.candidate); } catch (e) { if (!peer.ignoreOffer) throw e; }
      }
    } catch (e) { console.warn('ses sinyali', e); }
  }

  function status(){
    const connected = [...peers.values()].filter(p => p.pc.connectionState === 'connected').length;
    return { supported: !!(navigator.mediaDevices && window.RTCPeerConnection), enabled, starting, ptt, speaking: !!(track && track.enabled), canTalk: canTalk(), peers: peers.size, connected };
  }

  return { init, enable, disable, sync, setPtt, status, isTalking: id => talking.has(id) };
})();

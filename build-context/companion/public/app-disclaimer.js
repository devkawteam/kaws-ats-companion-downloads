// Reading this notice does not grant consent to recording or training.
(() => {
  const K = window.KAW16; if (!K) return;
  K.pages.push({ name: 'privacy', icon: 'i', label: 'Privacy & disclaimers', group: 'Setup', index: 1,
    html: `<div class="panel"><div class="panel-head"><h2>Privacy &amp; disclaimers</h2></div>
    <div class="panel-body" style="max-width:860px;line-height:1.7">
    <p class="v16-note"><b>Before using AI, voice or community services:</b> never share passwords, payment details or information you would not want processed by others. Updated October 7, 2026.</p>
    <h3>Independent community project</h3>
    <p>KAW’s ATS Playground Companion is an independent community project for American Truck Simulator. Discord, dedicated game servers and separate FiveM activities have their own rules. This project is not endorsed by Discord, SCS Software, Rockstar Games or Cfx.re. Their games, services and trademarks belong to their owners.</p>
    <h3>Local storage and online processing</h3>
    <p>Settings, trip records and some feature data are stored locally. Jarvis keeps recent chat text in this browser; saved memories are kept by the local Companion and included in later requests. Use the new-conversation and memory controls to clear these local items. This does not delete copies already processed by outside providers.</p>
    <p>Public Jarvis sends the relay your installation identifier, driver name, recent messages, saved memories and limited game-trip facts, such as truck, cargo, speed and nearest game town. Web queries go to search providers. Online speech recognition processes microphone audio through your browser’s speech provider. Optional natural voices send reply text to the voice provider. Provider policies govern their processing and retention; replies may repeat information you disclosed.</p>
    <p>Enabled convoy sharing, CB voice, Discord integrations and other online features send information needed for those features to their services or participants. Review sharing settings for identity, route, game location and truck details. Others may copy shared material. Community channels and AI conversations should not be treated as confidential.</p>
    <p>Public Companion Jarvis is separate from KAW’s private assistant and Intelligence systems. It is not given access to private email, calendars, business knowledge or PC-control tools. Only approved public community knowledge is intended for this assistant.</p>
    <h3>Microphone, recordings and streams</h3>
    <p>Ordinary Jarvis conversation does not save an audio recording in the Companion, but online speech processing is still required. Optional voice-pack recording saves clips when you choose Record; offline push-to-talk captures audio for transcription. Check the microphone indicator and use Stop conversation to end Jarvis listening.</p>
    <p class="v16-note"><b>Community recording notice: you may be recorded during community activities.</b> KAW, community hosts or participants may record or stream gameplay, voice conversations, Discord activities and events at any time during participation. This is separate from Jarvis’s AI features. Recording or streaming may occur throughout participation. If you do not consent to being recorded, do not join or participate in a recorded activity; ask for an unrecorded alternative. Do not share information you do not want captured or published. This community warning applies wherever KAW or participants are located, including all U.S. states and territories and other countries. Local recording and privacy laws still apply.</p>
    <p>This general warning does not replace legally required advance notice or consent. Ask before sharing another person’s voice or personal information. Before community-operated recording or reuse for quality assurance or AI improvement, organizers must provide a separate clear notice explaining what is captured, purpose, recipients, retention and a contact for questions, and obtain consent required by applicable law.</p>
    <p><b>This notice does not start recording, authorize AI training, or make joining a server consent to either.</b> Recorded events need their own notice and consent process. Do not secretly record others.</p>
    <h3>AI and safe use</h3>
    <p>AI can misunderstand you, invent details or give outdated answers, even with web sources. Verify important information and live server or convoy details with official sources. Answers are for general information and entertainment, not professional medical, legal, financial or safety advice. Game navigation is not real-world navigation. Never operate this app while driving a real vehicle.</p>
    <h3>Discord, downloads, mods and servers</h3>
    <p>Discord is a separate service with its own <a href="https://discord.com/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a> and <a href="https://discord.com/terms" target="_blank" rel="noopener noreferrer">Terms</a>. We cannot guarantee that Discord, the Companion or third-party downloads will never collect data, contain defects or affect your computer. Use official downloads, review permissions, keep software updated and back up game files before installing mods.</p>
    <p>Mods and experimental ATS or FiveM services may crash, conflict, change, lose progress or become unavailable. Features and access may change for maintenance or moderation. Follow game, platform, licensing and community rules. Only upload content you have the right to share.</p>
    <h3>Limits and questions</h3>
    <p>Community software is provided as available, without promises of uninterrupted operation, perfect accuracy or compatibility, to the extent permitted by law. Nothing here removes rights or responsibilities that applicable law does not allow to be excluded. This notice is not a guarantee against legal claims.</p>
    <p>Ask KAW or a community moderator in the community Discord about privacy, recording or a feature before using it. Avoid sensitive details in public support channels. Separate service policies and event-specific notices still apply.</p>
    </div></div>` });
  K.onReady.push(() => {
    const open = () => K.go?.('privacy');
    const footer = K.q('.footer');
    if (footer) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = 'Privacy & disclaimers'; b.style.marginLeft = '12px'; b.onclick = open; footer.appendChild(b); }
    const help = K.q('#hlpPrivacy'); if (help) help.onclick = open;
  });
})();

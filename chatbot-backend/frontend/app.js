// Hardcode the backend URL to your Ngrok tunnel
function getApiBase() {
    return 'https://illusion-winter-radar.ngrok-free.dev/api';
}

const API_BASE = getApiBase();

let currentConversationId = null;

function getToken() {
    return localStorage.getItem('auth_token');
}

function checkAuth() {
    if (!getToken()) {
        window.location.href = 'index.html';
    }
}

function logout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_info');
    window.location.href = 'index.html';
}

async function login() {
    const u = document.getElementById('login-username').value;
    const p = document.getElementById('login-password').value;
    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({username: u, password: p})
        });
            
            const contentType = res.headers.get("content-type");
            if (!res.ok && (!contentType || !contentType.includes("application/json"))) {
                document.getElementById('login-error').innerText = `Server error ${res.status}. Check backend terminal.`;
                console.error("Server crashed. HTML/Text response:", await res.text());
                return;
            }
            
        const data = await res.json();
        if(res.ok) {
            localStorage.setItem('auth_token', data.token);
            localStorage.setItem('user_info', JSON.stringify({username: data.username, tier: data.tier}));
            window.location.href = 'dashboard.html';
        } else {
            document.getElementById('login-error').innerText = data.detail || 'Login failed';
        }
    } catch (e) {
        document.getElementById('login-error').innerText = 'Network error';
    }
}

async function signup() {
    const u = document.getElementById('signup-username').value;
    const e = document.getElementById('signup-email').value;
    const p = document.getElementById('signup-password').value;
    try {
        const res = await fetch(`${API_BASE}/auth/signup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({username: u, email: e, password: p})
        });
        const data = await res.json();
        if(res.ok) {
            alert('Signup successful! Please login.');
            toggleMode('login');
        } else {
            let errorMsg = data.detail;
            if (Array.isArray(errorMsg)) {
                errorMsg = errorMsg.map(err => err.msg).join(', ');
            }
            document.getElementById('signup-error').innerText = errorMsg || 'Signup failed';
        }
    } catch (err) {
        document.getElementById('signup-error').innerText = 'Network error';
    }
}

async function verifyEmail() {
    const e = document.getElementById('verify-email').value;
    const c = document.getElementById('verify-code').value;
    try {
        const res = await fetch(`${API_BASE}/auth/verify-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({email: e, code: c})
        });
        const data = await res.json();
        if(res.ok) {
            alert('Email verified and account created! Please login.');
            toggleMode('login');
        } else {
            document.getElementById('verify-error').innerText = data.detail || 'Verification failed';
        }
    } catch(err) {
        document.getElementById('verify-error').innerText = 'Network error';
    }
}

async function fetchUsage() {
    try {
        const res = await fetch(`${API_BASE}/usage/remaining`, {
            headers: {
                'Authorization': `Bearer ${getToken()}`,
                'ngrok-skip-browser-warning': 'true'
            }
        });
        if(res.status === 401) return logout();
        const data = await res.json();
        if(res.ok) {
            document.getElementById('user-tier').innerText = data.tier;
            const u7 = data.usage.llama2_7b_qwen2_7b;
            document.getElementById('usage-7b').innerText = `${u7.used} / ${u7.limit === null ? 'Unlimited' : u7.limit} used`;
            const u8 = data.usage.llama3_8b;
            document.getElementById('usage-8b').innerText = `${u8.used} / ${u8.limit === null ? 'Unlimited' : u8.limit} used`;
            const u13 = data.usage.llama2_13b;
            document.getElementById('usage-13b').innerText = `${u13.used} / ${u13.limit} used`;
        }
    } catch(e) {
        console.error(e);
    }
}

function appendMessage(text, sender, model) {
    const div = document.createElement('div');
    div.className = `message ${sender}`;
    div.innerText = text;
    if(model) {
        const ts = document.createElement('span');
        ts.className = 'ts';
        ts.innerText = model;
        div.appendChild(ts);
    }
    const container = document.getElementById('chat-messages');
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

async function loadConversations() {
    try {
        const res = await fetch(`${API_BASE}/chat/conversations`, {
            headers: {
                'Authorization': `Bearer ${getToken()}`,
                'ngrok-skip-browser-warning': 'true'
            }
        });
        if(res.status === 401) return logout();
        const data = await res.json();
        if(res.ok) {
            const list = document.getElementById('conversations-list');
            if(!list) return; // Prevent errors on non-chat pages
            list.innerHTML = '';
            data.conversations.forEach(c => {
                const wrap = document.createElement('div');
                wrap.style.display = 'flex';
                wrap.style.gap = '5px';
                wrap.style.marginBottom = '5px';

                const btn = document.createElement('button');
                btn.className = 'conv-btn';
                btn.id = `conv-${c.conversation_id}`;
                btn.innerText = c.title || 'New Chat';
                btn.onclick = () => loadHistory(c.conversation_id);
                btn.style.flex = '1';

                const menuBtn = document.createElement('button');
                menuBtn.innerText = '...';
                menuBtn.className = 'dropbtn';
                menuBtn.style.padding = '0 10px';
                menuBtn.style.background = '#888';
                menuBtn.style.color = '#fff';
                menuBtn.style.border = 'none';
                menuBtn.style.borderRadius = '8px';
                menuBtn.style.cursor = 'pointer';
                
                const dropdownDiv = document.createElement('div');
                dropdownDiv.className = 'dropdown-content';
                dropdownDiv.id = `dropdown-${c.conversation_id}`;
                
                const renameBtn = document.createElement('button');
                renameBtn.innerText = 'Rename';
                renameBtn.onclick = async () => {
                    const newTitle = prompt('Enter new title:', c.title);
                    if(newTitle && newTitle !== c.title) {
                        await fetch(`${API_BASE}/chat/conversation/${c.conversation_id}`, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${getToken()}`,
                                'ngrok-skip-browser-warning': 'true'
                            },
                            body: JSON.stringify({title: newTitle})
                        });
                        loadConversations();
                    }
                };
                
                const delBtn = document.createElement('button');
                delBtn.innerText = 'Delete';
                delBtn.style.color = 'red';
                delBtn.onclick = async () => {
                    if(confirm('Delete this chat?')) {
                        await fetch(`${API_BASE}/chat/conversation/${c.conversation_id}`, {
                            method: 'DELETE',
                            headers: {
                                'Authorization': `Bearer ${getToken()}`,
                                'ngrok-skip-browser-warning': 'true'
                            }
                        });
                        if(currentConversationId === c.conversation_id) newChat();
                        loadConversations();
                    }
                };

                dropdownDiv.appendChild(renameBtn);
                dropdownDiv.appendChild(delBtn);

                const dropdownWrap = document.createElement('div');
                dropdownWrap.className = 'dropdown';
                dropdownWrap.appendChild(menuBtn);
                dropdownWrap.appendChild(dropdownDiv);
                
                menuBtn.onclick = (e) => {
                    e.stopPropagation();
                    document.getElementById(`dropdown-${c.conversation_id}`).classList.toggle("show");
                };

                wrap.appendChild(btn);
                wrap.appendChild(dropdownWrap);
                list.appendChild(wrap);
            });
            
            if (currentConversationId) {
                // Highlight the active conversation without reloading history
                const btn = document.getElementById(`conv-${currentConversationId}`);
                if (btn) btn.classList.add('active');
            } else if (data.conversations.length > 0) {
                // Automatically load the latest conversation if it exists and nothing is active
                loadHistory(data.conversations[0].conversation_id);
            }
        }
    } catch(e) {
        console.error(e);
    }
}

async function loadMemories() {
    try {
        const res = await fetch(`${API_BASE}/memory/`, {
            headers: { 'Authorization': `Bearer ${getToken()}`, 'ngrok-skip-browser-warning': 'true' }
        });
        if(res.ok) {
            const data = await res.json();
            const list = document.getElementById('memories-list');
            if(!list) return;
            list.innerHTML = '';
            if (data.memories.length === 0) {
                list.innerText = 'No memories saved yet.';
                return;
            }
            data.memories.forEach(m => {
                const div = document.createElement('div');
                div.className = 'memory-item';
                
                const span = document.createElement('span');
                span.innerText = m.content;
                
                const actions = document.createElement('div');
                actions.className = 'memory-actions';
                
                const editBtn = document.createElement('button');
                editBtn.className = 'memory-edit';
                editBtn.innerText = 'Edit';
                editBtn.onclick = () => editMemory(m.memory_id, m.content);
                
                const delBtn = document.createElement('button');
                delBtn.className = 'memory-del';
                delBtn.innerText = 'Delete';
                delBtn.onclick = () => deleteMemory(m.memory_id);
                
                actions.appendChild(editBtn);
                actions.appendChild(delBtn);
                
                div.appendChild(span);
                div.appendChild(actions);
                list.appendChild(div);
            });
        }
    } catch(e) {
        console.error(e);
    }
}

async function editMemory(id, oldContent) {
    const newContent = prompt('Edit memory:', oldContent);
    if (newContent && newContent !== oldContent) {
        await fetch(`${API_BASE}/memory/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`,
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({content: newContent})
        });
        loadMemories();
    }
}

async function deleteMemory(id) {
    if (confirm('Delete this memory?')) {
        await fetch(`${API_BASE}/memory/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getToken()}`, 'ngrok-skip-browser-warning': 'true' }
        });
        loadMemories();
    }
}

function newChat() {
    currentConversationId = null;
    const msgContainer = document.getElementById('chat-messages');
    if (msgContainer) msgContainer.innerHTML = '';
    document.querySelectorAll('.conv-btn').forEach(btn => btn.classList.remove('active'));
}

async function loadHistory(conversationId = null) {
    const msgContainer = document.getElementById('chat-messages');
    if (msgContainer) msgContainer.innerHTML = '';
    currentConversationId = conversationId;
    
    // Update active class on sidebar
    document.querySelectorAll('.conv-btn').forEach(btn => btn.classList.remove('active'));
    if (conversationId) {
        const btn = document.getElementById(`conv-${conversationId}`);
        if (btn) btn.classList.add('active');
    }

    if (!conversationId) return; // New chat, nothing to load

    try {
        const res = await fetch(`${API_BASE}/chat/history?conversation_id=${conversationId}`, {
            headers: {
                'Authorization': `Bearer ${getToken()}`,
                'ngrok-skip-browser-warning': 'true'
            }
        });
        if(res.status === 401) return logout();
        const data = await res.json();
        if(res.ok) {
            data.messages.reverse().forEach(m => {
                appendMessage(m.user_message, 'user');
                appendMessage(m.ai_response, 'ai', m.model_used);
            });
        }
    } catch(e) {
        console.error(e);
    }
}

let currentAbortController = null;

async function sendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if(!text) return;
    const model = document.getElementById('model-select').value;
    const webSearch = document.getElementById('web-search-toggle') ? document.getElementById('web-search-toggle').checked : false;
    
    let systemPrompt = null;
    const systemPromptEl = document.getElementById('system-prompt');
    if (systemPromptEl && systemPromptEl.style.display !== 'none' && systemPromptEl.value.trim() !== '') {
        systemPrompt = systemPromptEl.value.trim();
    }
    
    appendMessage(text, 'user');
    input.value = '';
    const btn = document.getElementById('send-btn');
    btn.disabled = true;
    
    const stopBtn = document.getElementById('stop-btn');
    if (stopBtn) stopBtn.style.display = 'inline-block';
    
    document.getElementById('chat-error').innerText = 'AI is thinking...';
    
    currentAbortController = new AbortController();
    
    try {
        const body = {message: text, model_id: model, web_search: webSearch};
        if (systemPrompt) body.system_prompt = systemPrompt;
        if (currentConversationId) {
            body.conversation_id = currentConversationId;
        }

        const res = await fetch(`${API_BASE}/chat/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`,
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify(body),
            signal: currentAbortController.signal
        });
        const data = await res.json();
        if(res.ok) {
            document.getElementById('chat-error').innerText = '';
            appendMessage(data.ai_response, 'ai', data.model_used);
            
            // If this was a new chat, we just got a conversation_id back
            if (!currentConversationId && data.conversation_id) {
                currentConversationId = data.conversation_id;
                loadConversations(); // refresh the sidebar
            }
        } else {
            document.getElementById('chat-error').innerText = data.detail || 'Error';
        }
    } catch(e) {
        if (e.name === 'AbortError') {
            document.getElementById('chat-error').innerText = 'AI generation stopped.';
        } else {
            document.getElementById('chat-error').innerText = 'Network error';
        }
    } finally {
        btn.disabled = false;
        if (stopBtn) stopBtn.style.display = 'none';
        currentAbortController = null;
        input.focus();
    }
}

function stopAI() {
    if (currentAbortController) {
        currentAbortController.abort();
    }
}

// Passkey implementation
const { startRegistration, startAuthentication } = window.SimpleWebAuthnBrowser || {};

async function signupWithPasskey() {
    const u = document.getElementById('signup-username').value;
    const e = document.getElementById('signup-email').value;
    
    if (!u || !e) {
        document.getElementById('signup-error').innerText = 'Username and Email are required for Passkey signup.';
        return;
    }
    
    if (!startRegistration) {
        document.getElementById('signup-error').innerText = 'Passkey library not loaded.';
        return;
    }

    try {
        const resp = await fetch(`${API_BASE}/webauthn/register/options`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({ username: u, email: e })
        });
        
        const data = await resp.json();
        if (!resp.ok) {
            document.getElementById('signup-error').innerText = data.detail || 'Failed to get passkey options';
            return;
        }

        const attResp = await startRegistration({ optionsJSON: data.options });
        
        const verifyResp = await fetch(`${API_BASE}/webauthn/register/verify`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({
                session_id: data.session_id,
                credential: attResp
            })
        });

        const verifyData = await verifyResp.json();
        if (verifyResp.ok) {
            localStorage.setItem('auth_token', verifyData.token);
            localStorage.setItem('user_info', JSON.stringify({username: verifyData.username, tier: verifyData.tier}));
            window.location.href = 'dashboard.html';
        } else {
            document.getElementById('signup-error').innerText = verifyData.detail || 'Passkey verification failed';
        }
    } catch (err) {
        console.error(err);
        document.getElementById('signup-error').innerText = 'Passkey error: ' + err.message;
    }
}

async function loginWithPasskey() {
    const u = document.getElementById('login-username').value;
    if (!u) {
        document.getElementById('login-error').innerText = 'Username is required for Passkey login.';
        return;
    }
    
    if (!startAuthentication) {
        document.getElementById('login-error').innerText = 'Passkey library not loaded.';
        return;
    }

    try {
        const resp = await fetch(`${API_BASE}/webauthn/login/options`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({ username: u })
        });
        
        const data = await resp.json();
        if (!resp.ok) {
            document.getElementById('login-error').innerText = data.detail || 'Failed to get passkey options';
            return;
        }

        const asseResp = await startAuthentication({ optionsJSON: data.options });
        
        const verifyResp = await fetch(`${API_BASE}/webauthn/login/verify`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({
                session_id: data.session_id,
                credential: asseResp
            })
        });

        const verifyData = await verifyResp.json();
        if (verifyResp.ok) {
            localStorage.setItem('auth_token', verifyData.token);
            localStorage.setItem('user_info', JSON.stringify({username: verifyData.username, tier: verifyData.tier}));
            window.location.href = 'dashboard.html';
        } else {
            document.getElementById('login-error').innerText = verifyData.detail || 'Passkey verification failed';
        }
    } catch (err) {
        console.error(err);
        document.getElementById('login-error').innerText = 'Passkey error: ' + err.message;
    }
}
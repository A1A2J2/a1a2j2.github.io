// Dynamically load the backend URL configured by the user, defaulting to current host or relative path
function getApiBase() {
    const savedUrl = localStorage.getItem('backend_url');
    if (savedUrl) {
        return `${savedUrl}/api`;
    }
    // Use your actual Ngrok URL
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
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username: u, password: p})
        });
        const data = await res.json();
        if(res.ok) {
            localStorage.setItem('auth_token', data.token);
            localStorage.setItem('user_info', JSON.stringify({username: data.username, tier: data.tier}));
            window.location.href = '/dashboard.html';
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
            headers: {'Content-Type': 'application/json'},
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

async function fetchUsage() {
    try {
        const res = await fetch(`${API_BASE}/usage/remaining`, {
            headers: {'Authorization': `Bearer ${getToken()}`}
        });
        if(res.status === 401) return logout();
        const data = await res.json();
        if(res.ok) {
            document.getElementById('user-tier').innerText = data.tier;
            const u7 = data.usage.llama2_7b_qwen2_7b;
            document.getElementById('usage-7b').innerText = `${u7.used} / ${u7.limit === null ? 'Unlimited' : u7.limit} used`;
            const u14 = data.usage.llama2_14b;
            document.getElementById('usage-14b').innerText = `${u14.used} / ${u14.limit} used`;
            const u32 = data.usage.llama2_32b;
            document.getElementById('usage-32b').innerText = `${u32.used} / ${u32.limit} used`;
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
            headers: {'Authorization': `Bearer ${getToken()}`}
        });
        if(res.status === 401) return logout();
        const data = await res.json();
        if(res.ok) {
            const list = document.getElementById('conversations-list');
            if(!list) return; // Prevent errors on non-chat pages
            list.innerHTML = '';
            data.conversations.forEach(c => {
                const btn = document.createElement('button');
                btn.className = 'conv-btn';
                btn.id = `conv-${c.conversation_id}`;
                btn.innerText = c.title || 'New Chat';
                btn.onclick = () => loadHistory(c.conversation_id);
                list.appendChild(btn);
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
            headers: {'Authorization': `Bearer ${getToken()}`}
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

async function sendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if(!text) return;
    const model = document.getElementById('model-select').value;
    
    appendMessage(text, 'user');
    input.value = '';
    const btn = document.getElementById('send-btn');
    btn.disabled = true;
    document.getElementById('chat-error').innerText = 'AI is thinking...';
    
    try {
        const body = {message: text, model_id: model};
        if (currentConversationId) {
            body.conversation_id = currentConversationId;
        }

        const res = await fetch(`${API_BASE}/chat/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify(body)
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
        document.getElementById('chat-error').innerText = 'Network error';
    } finally {
        btn.disabled = false;
        input.focus();
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
            headers: { 'Content-Type': 'application/json' },
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: data.session_id,
                credential: attResp
            })
        });

        const verifyData = await verifyResp.json();
        if (verifyResp.ok) {
            localStorage.setItem('auth_token', verifyData.token);
            localStorage.setItem('user_info', JSON.stringify({username: verifyData.username, tier: verifyData.tier}));
            window.location.href = '/dashboard.html';
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
            headers: { 'Content-Type': 'application/json' },
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: data.session_id,
                credential: asseResp
            })
        });

        const verifyData = await verifyResp.json();
        if (verifyResp.ok) {
            localStorage.setItem('auth_token', verifyData.token);
            localStorage.setItem('user_info', JSON.stringify({username: verifyData.username, tier: verifyData.tier}));
            window.location.href = '/dashboard.html';
        } else {
            document.getElementById('login-error').innerText = verifyData.detail || 'Passkey verification failed';
        }
    } catch (err) {
        console.error(err);
        document.getElementById('login-error').innerText = 'Passkey error: ' + err.message;
    }
}
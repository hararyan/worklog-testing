// Share links for your manager (read-only). Loaded after app.js; uses its toast().
// The dialog creates a link, lists your links, and lets you delete them.

document.querySelectorAll('dialog [data-close]').forEach((b) =>
    b.addEventListener('click', () => b.closest('dialog').close())
);

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

const shareUrl = (s) => new URL('share.html', location.href).href + '#' + s.token;

async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { }
    try { // fallback for plain-http pages, where the clipboard API is not available
        const ta = el('textarea', { style: 'position:fixed;top:0;left:0;opacity:0' });
        ta.value = text;
        document.body.append(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
    } catch (e) { return false; }
}

async function copyShare(s) {
    const url = shareUrl(s);
    if (await copyText(url)) toast('Link copied');
    else prompt('Copy this link:', url);
}

const SHARE_SETUP_HINT = 'Run schema-sharing.sql in Supabase first (see README).';

function shareRow(s) {
    const expired = s.expires_at && new Date(s.expires_at) <= new Date();
    const range = s.date_from || s.date_to
        ? `${s.date_from ? fmtDate(s.date_from) : 'start'} – ${s.date_to ? fmtDate(s.date_to) : 'now'}`
        : 'All entries';
    const exp = s.expires_at ? (expired ? 'Expired' : 'Expires ' + new Date(s.expires_at).toLocaleDateString()) : 'Never expires';
    return el('div', { class: 'share-item' },
        el('div', { class: 'info' }, el('b', { text: s.display_name || 'Shared report' }), el('small', { text: `${range} · ${exp}` })),
        expired ? null : el('button', { class: 'btn small', text: 'Copy link', onclick: () => copyShare(s) }),
        expired ? null : el('a', { class: 'btn small', text: 'Preview', href: shareUrl(s), target: '_blank', rel: 'noopener' }),
        el('button', { class: 'btn small danger', text: 'Delete', onclick: () => deleteShare(s) })
    );
}

async function loadShares() {
    const { data, error } = await sb.from('shares').select('*').order('created_at', { ascending: false });
    if (error) {
        $('#shList').replaceChildren(el('div', { class: 'err', text: error.message.includes('shares') ? SHARE_SETUP_HINT : error.message }));
        return;
    }
    $('#shList').replaceChildren(...data.map(shareRow));
}

async function deleteShare(s) {
    if (!confirm('Delete this link? Anyone using it will lose access immediately.')) return;
    const { error } = await sb.from('shares').delete().eq('id', s.id);
    if (error) { $('#shErr').textContent = error.message; return; }
    toast('Link deleted');
    loadShares();
}

$('#shareBtn').addEventListener('click', () => {
    $('#shErr').textContent = '';
    $('#shName').value = lsGet('worklog.name') || '';
    $('#shareDlg').showModal();
    loadShares();
});

$('#shCreate').addEventListener('click', async () => {
    const from = $('#shFrom').value || null, to = $('#shTo').value || null;
    $('#shErr').textContent = '';
    if (from && to && from > to) { $('#shErr').textContent = '“From” must be before “To”.'; return; }
    const days = parseInt($('#shExp').value, 10);
    const name = $('#shName').value.trim();
    lsSet('worklog.name', name);
    const row = {
        display_name: name,
        date_from: from,
        date_to: to,
        expires_at: days ? new Date(Date.now() + days * 86400000).toISOString() : null,
    };
    const btn = $('#shCreate');
    btn.disabled = true;
    try {
        const { data, error } = await sb.from('shares').insert(row).select().single();
        if (error) throw error;
        toast((await copyText(shareUrl(data))) ? 'Link created and copied' : 'Link created');
        await loadShares();
    } catch (err) {
        $('#shErr').textContent = err.message.includes('shares') ? SHARE_SETUP_HINT : err.message;
    } finally {
        btn.disabled = false;
    }
});
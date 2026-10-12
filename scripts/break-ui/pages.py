"""The surfaces the harness opens. Steps run after load: ('click', selector), ('wait', selector), ('js', code),
('press', key), ('type', text), ('sleep', ms). A third item limits a step to some devices."""
CLIP = '%032x' % 1
MEET = '%024x' % 21
PHONE = ('phone', 'phone-edge', 'w320')

CLICK_TEXT = "(function(rx){var b=Array.from(document.querySelectorAll('button,a,[role=tab]')).find(function(x){return rx.test(x.textContent.trim());}); if(b) b.click();})(%s)"
OPEN_CH = [('click', '.ch-row', PHONE), ('sleep', 700, PHONE)]
BRAIN = lambda sel: [('js', "(function(){var e=document.querySelector('%s'); if(e) e.scrollIntoView({block:'start'});})()" % sel), ('sleep', 600)]
WORK = lambda view: [('click', '.wc-tab[data-view="%s"]' % view), ('sleep', 900)]

PAGES = {
    'today': {'path': '/', 'about': 'Today cards, badges, Your day', 'from': '/help/'},
    'nav-more': {'path': '/', 'about': 'Phone tab bar and the More sheet', 'steps': [('click', '#h-bar-more', PHONE), ('sleep', 500)], 'full': False},
    'bell': {'path': '/', 'about': 'The bell list', 'steps': [('click', '#wm-bell'), ('sleep', 400)], 'full': False},
    'work-home': {'path': '/work-home/', 'about': 'Work Overview'},
    'work-open': {'path': '/work/', 'about': 'Work Center, Open actions', 'settle': 1500},
    'work-asks': {'path': '/work/?view=asks', 'about': 'Work Center, Asks', 'settle': 1500, 'steps': [('sleep', 900)]},
    'work-mine': {'path': '/work/?view=mine', 'about': 'Work Center, My partners', 'settle': 1500, 'steps': [('sleep', 900)]},
    'work-entry': {'path': '/work/?view=intake', 'about': 'Work Center, Entry', 'settle': 1500, 'steps': [('sleep', 900)]},
    'work-ty': {'path': '/work/?view=ty', 'about': 'Work Center, Thank-yous', 'settle': 1500, 'steps': [('sleep', 900)]},
    'work-gifts': {'path': '/work/?view=gifts', 'about': 'Work Center, Gifts to thank', 'settle': 1500, 'steps': [('js', "(function(){var b=document.querySelector('.wc-tab[data-view=gifts]'); if(b) b.click();})()"), ('sleep', 900)]},
    'work-hqty': {'path': '/work/?view=hqty', 'about': 'Work Center, letters', 'settle': 1500, 'steps': [('sleep', 900)]},
    'partner': {'path': '/work/partner/5001', 'about': 'Partner page, a two-person household', 'settle': 1500},
    'partner-org': {'path': '/work/partner/5002', 'about': 'Partner page, an organization', 'settle': 1500},
    'partner-drawer': {'path': '/work/', 'about': 'Partner drawer over the Work Center', 'settle': 1500, 'steps': [('click', '.wc-row [data-partner-id]'), ('sleep', 1200)], 'full': False},
    'receipts': {'path': '/receipts/', 'about': 'Receipts list', 'settle': 1500},
    'receipts-held': {'path': '/receipts/', 'about': 'Receipts, held', 'settle': 1500, 'steps': [('js', CLICK_TEXT % '/^(held|not printing|needs a look)/i'), ('sleep', 600)]},
    'receipts-past': {'path': '/receipts/', 'about': 'Receipts, past printings', 'settle': 1500, 'steps': [('js', CLICK_TEXT % '/^past/i'), ('sleep', 600)]},
    'foundations': {'path': '/foundations/', 'about': 'Foundations list', 'settle': 1500},
    'foundation-drawer': {'path': '/foundations/', 'about': 'Foundation drawer', 'settle': 1500, 'steps': [('click', '.fnd-table tbody tr'), ('sleep', 1200)], 'full': False},
    'meet': {'path': '/meet/', 'about': 'Meetings day view', 'settle': 1800},
    'meet-cluster': {'path': '/meet/', 'about': 'Meetings, eight in one hour', 'settle': 1800, 'full': False, 'steps': [('js', "(function(){var s=document.querySelector('.dv-tl__scroll'); if(s){ s.scrollTop=0; var e=document.querySelector('.dv-ev'); if(e) s.scrollTop=Math.max(0, e.offsetTop-40); s.scrollIntoView({block:'start'}); }})()"), ('sleep', 500)]},
    'meet-late': {'path': '/meet/', 'about': 'Meetings, one that runs past midnight', 'settle': 1800, 'full': False, 'steps': [('js', "(function(){var s=document.querySelector('.dv-tl__scroll'); if(s){ s.scrollTop=s.scrollHeight; s.scrollIntoView({block:'end'}); }})()"), ('sleep', 500)]},
    'meet-library': {'path': '/meet/library/', 'about': 'Notes library', 'settle': 1500},
    'meet-notes': {'path': '/meet/notes/?m=' + MEET, 'about': 'One meeting, notes page', 'settle': 1800},
    'chat': {'path': '/chat/', 'about': 'Chat, channel list and newest messages', 'settle': 2200, 'full': False, 'steps': OPEN_CH},
    'chat-list': {'path': '/chat/', 'about': 'Chat, channel list on a phone', 'settle': 2200, 'full': False},
    'chat-top': {'path': '/chat/', 'about': 'Chat, the worst messages', 'settle': 2200, 'full': False, 'steps': OPEN_CH + [('js', "(function(){var m=document.querySelector('.ch-msgs'); if(m) m.scrollTop=0;})()"), ('sleep', 500)]},
    'chat-mid': {'path': '/chat/', 'about': 'Chat, reactions, files and cards', 'settle': 2200, 'full': False, 'steps': OPEN_CH + [('js', "(function(){var m=document.querySelector('.ch-react'); if(m) m.scrollIntoView({block:'start'});})()"), ('sleep', 500)]},
    'chat-cards': {'path': '/chat/', 'about': 'Chat, link, clip, meeting and file cards', 'settle': 2200, 'full': False, 'steps': OPEN_CH + [('js', "(function(){var m=document.querySelector('.ch-meet, .ch-link'); if(m) m.scrollIntoView({block:'center'});})()"), ('sleep', 500)]},
    'chat-thread': {'path': '/chat/', 'about': 'Chat, a thread of 300 replies', 'settle': 2200, 'full': False, 'steps': OPEN_CH + [('js', "(function(){var b=document.querySelector('.ch-replies'); if(b){b.scrollIntoView(); b.click();}})()"), ('sleep', 1200)]},
    'chat-members': {'path': '/chat/', 'about': 'Chat, member list', 'settle': 2200, 'full': False, 'steps': OPEN_CH + [('js', "(function(){var b=document.querySelector('.ch-members') || document.querySelector('.ch-head__t'); if(b) b.click();})()"), ('sleep', 700), ('js', CLICK_TEXT % '/^Members/'), ('sleep', 600)]},
    'brain': {'path': '/brain/?c=c_0000', 'about': 'Favor Brain, text and tiles', 'settle': 2200, 'full': False, 'steps': BRAIN('.blk-text, .md-tbl')},
    'brain-tiles': {'path': '/brain/?c=c_0000', 'about': 'Favor Brain, tiles with huge numbers', 'settle': 2200, 'full': False, 'steps': BRAIN('.bc-tile')},
    'brain-table': {'path': '/brain/?c=c_0000', 'about': 'Favor Brain, a 40-column table', 'settle': 2200, 'full': False, 'steps': BRAIN('.blk-table')},
    'brain-partner': {'path': '/brain/?c=c_0000', 'about': 'Favor Brain, partner card', 'settle': 2200, 'full': False, 'steps': BRAIN('.card.pc')},
    'brain-team': {'path': '/brain/?c=c_0000', 'about': 'Favor Brain, team and chart', 'settle': 2200, 'full': False, 'steps': BRAIN('.card.team')},
    'brain-chart': {'path': '/brain/?c=c_0000', 'about': 'Favor Brain, chart', 'settle': 2200, 'full': False, 'steps': BRAIN('.card.chart')},
    'brain-steps': {'path': '/brain/?c=c_0000', 'about': 'Favor Brain, coverage, steps, confirm', 'settle': 2200, 'full': False, 'steps': BRAIN('.card.cov')},
    'brain-confirm': {'path': '/brain/?c=c_0000', 'about': 'Favor Brain, confirm, note, sheet', 'settle': 2200, 'full': False, 'steps': BRAIN('.card.cf')},
    'brain-choice': {'path': '/brain/?c=c_0000', 'about': 'Favor Brain, choices and files', 'settle': 2200, 'full': False, 'steps': BRAIN('.blk-choice__opts')},
    'brain-files': {'path': '/brain/?c=c_0000', 'about': 'Favor Brain, files and sources', 'settle': 2200, 'full': False, 'steps': BRAIN('.card.fcards')},
    'brain-panel': {'path': '/brain/?c=c_0000', 'about': 'Favor Brain, the full table panel, 1,000 rows', 'settle': 2200, 'full': False, 'steps': [('js', "(function(){var b=document.querySelector('[data-act=topen]'); if(b) b.click();})()"), ('sleep', 1800)]},
    'reports': {'path': '/reports/', 'about': 'Reports list', 'settle': 1200},
    'report': {'path': '/reports/?r=report-0', 'about': 'One report table', 'settle': 1500},
    'clips': {'path': '/clips/', 'about': 'Clips list', 'settle': 1500},
    'clips-all': {'path': '/clips/all/', 'about': 'Clips, everyone (admin)', 'settle': 1500},
    'clip-watch': {'path': '/c/' + CLIP, 'about': 'Clip watch page', 'settle': 2200},
    'help': {'path': '/help/', 'about': 'Help list', 'settle': 1200},
    'feedback': {'path': '/feedback/', 'about': 'Feedback list', 'settle': 1500},
    'palette': {'path': '/help/', 'about': 'Search palette results', 'settle': 1200, 'full': False, 'steps': [('js', "(document.querySelector('[data-cmdk-open]') || {click: function(){}}).click()"), ('sleep', 500), ('type', 'fa'), ('sleep', 1800)]},
}

// Original One Life game modules, merged into a single editable source file.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
const DEFAULT_CONFIG = {
  "config_version": "2.0",
  "tweaks": [],
  "texts": [{
    "id": "HINT_TEXT",
    "label": "Continue action",
    "value": "Continue",
    "default": "Continue",
    "max_length": 42
  }],
  "images": [],
  "playable": {
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "en",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
const GAME_STYLES = `@font-face{font-family:DM;src:url('./assets/fonts/DMSans.woff') format('woff');font-weight:100 900;font-display:swap}
:root{--cloud:#f1f2fc;--paper:#fff;--ink:#2a2844;--muted:#655f7c;--iris:#6150a4;--line:#dcd9eb;--sea:#257467;--unit:1px;color-scheme:light;font-family:DM,system-ui,sans-serif;color:var(--ink);background:var(--cloud)}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{overscroll-behavior:none}button{font:inherit;color:inherit;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}button:focus-visible{outline:3px solid var(--iris);outline-offset:3px}button:disabled{cursor:default}button,dialog{border:0}button svg{fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}button:active{filter:brightness(.95)}[hidden]{display:none!important}
#game{position:relative;width:100%;height:100%;background:var(--cloud);overflow:hidden}#layout{position:absolute;left:50%;top:50%;width:390px;height:598px;max-height:670px;padding:30px 30px 50px;transform:translate(-50%,-50%) scale(var(--scale,1));transform-origin:center;display:flex;flex-direction:column;gap:12px}
#opening{position:absolute;left:50%;top:50%;width:390px;height:598px;padding:30px 30px 50px;transform:translate(-50%,-50%) scale(var(--scale,1));transform-origin:center;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center}#opening h1{font-size:32px;line-height:1.15;letter-spacing:-1.1px;font-weight:700;margin:0}.opening-heading{flex:none}.opening-heading p{font-size:18px;line-height:1.35;margin:9px 0 0;font-weight:500}#birth-chart{flex:1;width:100%;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:12px}#birth-bars{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:7px;text-align:left}#birth-bars li{display:grid;grid-template-columns:94px minmax(0,1fr) 48px;gap:8px;align-items:center;min-height:22px;font-size:13px;line-height:1.3}.birth-country{min-width:0;overflow-wrap:anywhere}.birth-share{text-align:right;font-variant-numeric:tabular-nums;font-weight:500}.birth-track{display:block;height:9px;background:#dfdbea;border-radius:6px;overflow:hidden}.birth-fill{display:block;height:100%;width:var(--share);background:var(--bar-color);border-radius:6px;transform-origin:left;animation:birth-bars-in .55s cubic-bezier(.2,.7,.25,1) both}.birth-axis{margin-left:102px;margin-right:56px;display:flex;justify-content:space-between;gap:4px;color:var(--muted);font-size:11px;line-height:1.3}.birth-axis span:nth-child(2){white-space:nowrap}#birth{flex:none;width:100%;min-height:56px;background:var(--iris);color:white;border-radius:14px;padding:14px 30px;font-size:18px;font-weight:650;animation:birth-breathe 3s ease-in-out infinite}#birth:disabled{opacity:1;cursor:default}
#birth-reveal{position:absolute;left:50%;top:50%;width:390px;height:598px;padding:30px 30px 50px;transform:translate(-50%,-50%) scale(var(--scale,1));transform-origin:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;text-align:center;pointer-events:none}#reveal-title{font-size:18px;line-height:1.35;font-weight:500;letter-spacing:0;margin:0;color:var(--muted)}#country-window{position:relative;width:100%;height:252px;flex:none;overflow:hidden;mask-image:linear-gradient(transparent,black 32%,black 68%,transparent);-webkit-mask-image:linear-gradient(transparent,black 32%,black 68%,transparent)}#country-window:before{content:'';position:absolute;top:84px;left:0;right:0;height:84px;border-block:1px solid var(--line);pointer-events:none;z-index:1}#country-reel{will-change:transform}.roll-country{height:84px;padding:0 10px;display:grid;place-items:center;font-size:28px;font-weight:650;line-height:1.18;letter-spacing:-.6px;overflow-wrap:normal}#game[data-phase="birth-result"] .roll-country[data-winner="true"]{color:var(--iris)}
header{height:42px;flex:none;display:flex;justify-content:space-between;align-items:center}#age-block{display:flex;align-items:baseline;gap:6px;white-space:nowrap}#age{position:relative;display:inline-block;width:2ch;height:32px;font-size:28px;font-weight:750;line-height:32px;font-variant-numeric:tabular-nums}#age-block>span{font-size:12px;color:var(--muted)}#age-window{position:absolute;inset:0;overflow:hidden}#age-reel{display:block;will-change:transform}.age-year{display:block;height:32px;line-height:32px}#identity{text-align:right;display:flex;flex-direction:column;max-width:190px;line-height:1.35}#name{font-size:18px;font-weight:700}#place{font-size:12px;color:var(--muted)}
#life-path{display:flex;gap:4px;margin-top:0;height:4px;flex:none}#life-path i{display:block;flex:1;background:var(--line);border-radius:3px;transition:background .3s}#life-path i.lived{background:var(--iris)}#life-path i.now{background:var(--iris);box-shadow:0 0 0 2px #c6bee7}
#qualities{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;flex:none;height:58px;align-items:center;margin-top:2px}.quality{display:flex;flex-direction:column;gap:3px;position:relative}.quality-label{font-size:12px;color:var(--muted)}.quality-value{font-size:28px;font-weight:650;line-height:1;font-variant-numeric:tabular-nums}.quality-meter{height:3px;border-radius:3px;overflow:hidden;background:var(--line)}.quality-fill{display:block;height:100%;width:var(--value);background:var(--tone);transition:width .45s ease}
#story{flex:1;display:flex;flex-direction:column;justify-content:center;min-height:200px;outline:none;position:relative}.story-top{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--iris);font-weight:650;line-height:18px}#step{color:var(--muted);font-size:11px;font-weight:450}h2{font-size:24px;line-height:1.2;letter-spacing:-.65px;margin:6px 0 8px;font-weight:700}#event-body{font-size:18px;line-height:1.35;margin:0;letter-spacing:-.25px;max-width:330px}#changes{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;font-size:13px;font-weight:650;color:var(--sea)}#changes span{padding:3px 8px;background:#e2eee9;border-radius:6px}#changes .negative{color:#97415e;background:#f3e3e9}
#actions{flex:none;min-height:132px;display:grid;align-content:end}#choices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}#actions button{display:block;min-height:60px;width:100%;border-radius:14px;background:var(--iris);color:white;font-size:18px;font-weight:650;line-height:1.2;padding:8px 12px;overflow-wrap:anywhere;transition:background .16s}#actions button:disabled{opacity:.7}#actions button:hover{background:#54438f}
header{gap:8px}#identity{margin-left:auto;max-width:150px}#journal-button{width:44px;height:44px;background:#e6e2f1;border-radius:50%;display:grid;place-items:center;flex:none}#journal-button svg{width:20px;height:20px}#about-button{font-size:14px;min-height:44px;background:none;text-decoration:underline;color:var(--iris);width:100%;text-align:left}
#game[data-feed-preview="true"] #qualities,#game[data-feed-preview="true"] #journal-button,#game[data-feed-preview="true"] #actions{visibility:hidden}#game[data-feed-preview="true"] #story{max-width:275px}#game[data-feed-preview="true"] #layout{padding-top:60px;padding-bottom:80px}#game[data-paused="true"] *{animation-play-state:paused!important}
#game[data-feed-preview="true"] #opening{padding-top:65px;padding-bottom:75px;gap:10px}#game[data-feed-preview="true"] #birth-chart{max-width:275px}#game[data-feed-preview="true"] #birth-bars li{grid-template-columns:88px minmax(0,1fr) 47px;gap:6px;min-height:20px}#game[data-feed-preview="true"] .birth-axis{margin-left:94px;margin-right:53px}#game[data-feed-preview="true"] .birth-axis span:nth-child(2){visibility:hidden}#game[data-feed-preview="true"] #birth{visibility:hidden}
#game[data-feed-preview="true"] .birth-fill{animation:none;transform:none}
dialog{position:absolute;inset:0;max-width:calc(100% - 40px);width:360px;max-height:calc(100% - 60px);background:var(--cloud);color:var(--ink);padding:22px;border-radius:22px;overflow:auto;overscroll-behavior:contain}dialog::backdrop{background:#25213b70}.dialog-head{display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:-22px;background:var(--cloud);padding-top:2px;z-index:1}.dialog-head h2{font-size:24px;margin:0}.dialog-head button{min-width:44px;min-height:44px;border-radius:50%;background:#e4e1ef;font-size:28px}.dialog-done{width:100%;min-height:46px;background:var(--iris);color:white;border-radius:12px;font-weight:650;font-size:16px;margin-top:14px}dialog p{font-size:16px;line-height:1.5}#journal-person{font-size:13px;color:var(--muted);white-space:pre-line}#memories{list-style:none;padding:0;margin:14px 0 0}#memories li{position:relative;border-left:2px solid #c7bfdf;margin-left:6px;padding:0 0 22px 18px}#memories li:before{content:'';position:absolute;width:8px;height:8px;left:-5px;top:4px;border-radius:50%;background:var(--iris)}#memories .memory-age{display:block;color:var(--iris);font-size:12px;margin-bottom:4px}#memories strong{font-size:16px}#memories p{font-size:14px;margin:5px 0 0;line-height:1.5}#load-error{position:absolute;inset:20%;background:white;border-radius:16px;padding:20px;z-index:3}#load-error button{min-height:44px;background:var(--iris);color:white;padding:10px 15px;border-radius:9px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@keyframes birth-breathe{50%{box-shadow:0 0 0 7px #6150a415}}
@keyframes birth-bars-in{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}
`;
const gameStyle = document.createElement('style');
gameStyle.textContent = GAME_STYLES;
document.head.append(gameStyle);
for (const value of ['playable-inline-config', 'playable-config-inline']) {
  const node = document.createElement('script');
  node.id = value;
  node.type = 'application/json';
  node.textContent = JSON.stringify(DEFAULT_CONFIG);
  document.body.append(node);
}
function mountOneLife() {
  const option2 = (value, label, result, delta = {}, extra = {}) => ({
    id: value,
    label,
    result,
    delta,
    ...extra
  });
  const decision = (stage, title, body, ...choices) => ({
    stage,
    title,
    body,
    choices
  });
  function decisionFor(value, pick) {
    switch (value.index) {
      case 1:
        return pick(value, [decision('Childhood', 'First steps', 'At the park, another child offers you a toy. Your family waits nearby as you decide how to spend the afternoon.', option2('share', 'Play together', 'You build a crooked tower together. Soon you are asking when you can see your new friend again.', {
          bonds: 9,
          joy: 4
        }), option2('explore', 'Go exploring', 'The climbing frame becomes your castle. A few scraped knees cannot spoil the adventure.', {
          health: 8,
          joy: 5
        }), option2('build', 'Build something', 'You collect twigs and make a tiny house. Getting the roof to stay up feels like a great discovery.', {
          learning: 9,
          joy: 3
        }), option2('watch', 'Watch the birds', 'You sit quietly with your family and count the birds. It becomes a little ritual you share.', {
          bonds: 5,
          health: 4,
          joy: 4
        })), decision('Childhood', 'A rainy day', 'Rain taps against the window, keeping you indoors. There are pencils on the table and a long afternoon ahead.', option2('draw', 'Draw', 'A blank page becomes a whole new world. Your family puts the finished picture on the wall.', {
          learning: 7,
          joy: 5
        }), option2('play', 'Make a game', 'You turn cushions into stepping stones. Your family joins in, laughing as the rules keep changing.', {
          bonds: 8,
          joy: 5
        }), option2('bake', 'Help cook', 'You stir a bowl while someone tells you old family stories. The result is uneven, but everyone has a taste.', {
          bonds: 9,
          learning: 4
        }), option2('read', 'Hear a story', 'You curl up beside someone and listen. Later, you invent a different ending of your own.', {
          learning: 10,
          joy: 3
        }))]);
      case 2:
        return decision('Childhood', 'After school', 'The school day is over, but there is still time before dinner. A book, a ball and a borrowed instrument are waiting.', option2('read', 'Read a book', 'One story leads to another, and the library becomes a favorite place. You start keeping a list of questions.', {
          learning: 11,
          joy: 3
        }), option2('team', 'Join the team', 'You lose the first match, but gain friends. Practicing together gives your afternoons a new rhythm.', {
          health: 7,
          bonds: 8
        }), option2('music', 'Try some music', 'The first notes squeak, then a tune begins to emerge. Playing it for your family makes you beam.', {
          learning: 7,
          joy: 8
        }), option2('garden', 'Grow something', 'You plant seeds in an old container and check them every day. The first green shoot feels like a small miracle.', {
          health: 5,
          learning: 6,
          joy: 4
        }));
      case 3:
        return decision('Growing up', 'A setback', 'Your school project collapses the night before it is due. The pieces cover your desk, and you are not sure where to begin.', option2('help', 'Ask for help', 'A teacher helps you spot the weak point. You rebuild it yourself, learning that asking is not the same as giving up.', {
          learning: 8,
          bonds: 6
        }), option2('retry', 'Try it yourself', 'After a frustrating evening, you find a fix. You are tired the next morning, but proud of what you learned.', {
          learning: 12,
          joy: -4
        }), option2('group', 'Work with a friend', 'A classmate brings fresh ideas, and you share the work. The finished project belongs to both of you.', {
          bonds: 10,
          learning: 5
        }), option2('rethink', 'Start simpler', 'You let go of the complicated design and make a smaller version. It works, even if it is not what you first imagined.', {
          learning: 6,
          joy: 6
        }));
      case 4:
        return decision('Growing up', 'Free weekends', 'School fills the week, but your weekends are still yours. Friends have plans, a workshop is starting, and a local shop needs help.', option2('course', 'Take the class', 'You discover a skill you love and spend hours practicing. You miss a few gatherings, but find a new ambition.', {
          learning: 12,
          bonds: -3
        }, {
          education: 'evening classes'
        }), option2('friends', 'See friends', 'A summer of cheap snacks and small adventures begins. Years later, you still laugh about these weekends.', {
          joy: 10,
          bonds: 8
        }), option2('job', 'Take a weekend job', 'The work is repetitive, but your first wages feel different. You save most of them for a future you are still imagining.', {
          learning: 5,
          joy: -3
        }, {
          buffer: 12
        }), option2('train', 'Train outdoors', 'You choose a regular route and slowly go farther. It gives you a way to clear your head when school gets intense.', {
          health: 12,
          joy: 5
        }));
      case 5:
        return decision('Starting out', 'Your next step', 'School is ending, and familiar routines are falling away. You want independence, but there is more than one way to build it.', option2('study', 'Keep studying', 'A grant helps you earn a degree. The budget is tight, but long conversations and new ideas make the effort worthwhile.', {
          learning: 15,
          joy: -4
        }, {
          education: 'college degree',
          buffer: -8
        }), option2('work', 'Start work', 'Your first steady pay buys a little freedom. You learn from mistakes on the job and start putting money aside.', {
          learning: 5,
          bonds: 4
        }, {
          education: 'on-the-job training',
          buffer: 14
        }), option2('apprentice', 'Be an apprentice', 'A patient specialist teaches you the basics. The pay is modest, but each week you can do something you could not do before.', {
          learning: 11,
          bonds: 5
        }, {
          education: 'apprenticeship',
          buffer: 5
        }), option2('pause', 'Take time to plan', 'You do temporary work and help at home while you think. Your plans take longer to form, but begin to feel like your own.', {
          joy: 7,
          bonds: 7
        }, {
          education: 'self-directed study',
          buffer: -4
        }));
      case 6:
        return decision('Building a life', 'A working life', 'You have some experience now and want work that fits you. A practical skill, a creative idea and a chance to help others all pull at you.', option2('trade', 'Learn a trade', 'Practice turns into a profession, and people begin asking for you by name. Busy weeks leave little spare time.', {
          learning: 10,
          joy: -3
        }, {
          career: 'craft specialist',
          buffer: 14
        }), option2('people', 'Help people', 'You join a community team and learn to listen before offering answers. The pay is modest, but the work feels useful.', {
          bonds: 11,
          joy: 5
        }, {
          career: 'community worker',
          buffer: 8
        }), option2('create', 'Do creative work', 'Your first commissions are small and uncertain. Seeing an idea become something real keeps you going.', {
          learning: 8,
          joy: 10
        }, {
          career: 'creative freelancer',
          buffer: -4
        }), option2('business', 'Start a business', 'You put savings into a small venture and learn as you go. Finding the first regular customers takes patience.', {
          learning: 12,
          joy: 3,
          health: -4
        }, {
          career: 'small business owner',
          buffer: -10
        }));
      case 7:
        {
          const name = pick(value, ['Alex', 'Sam', 'Robin']);
          return decision('Building a life', 'A connection', name + ' has become the person you tell small things to. One evening, they ask whether this could be more than friendship.', option2('date', 'Give it a try', 'Ordinary days become shared days. You learn each other’s habits and make room for a life together.', {
            bonds: 13,
            joy: 6
          }, {
            companion: name,
            buffer: -7
          }), option2('solo', 'Stay friends', 'The conversation is awkward, but honest. You keep a valued friendship and the freedom to shape your own days.', {
            joy: 8,
            learning: 4,
            bonds: 4
          }), option2('slow', 'Take it slowly', 'You begin with quiet walks and unhurried conversations. By winter, a gentle relationship has grown.', {
            bonds: 10,
            learning: 5
          }, {
            companion: name,
            buffer: -3
          }), option2('focus', 'Follow your plans', 'You explain that your attention is elsewhere right now. Your plans move forward, though you miss the closeness for a while.', {
            learning: 7,
            joy: -4
          }, {
            buffer: 8
          }));
        }
      case 8:
        return decision('Turning points', 'A leak at home', 'You wake to water dripping into the kitchen. A pipe needs attention, and the repair was not part of this month’s plans.', option2('pay', 'Hire someone', value.buffer < 20 ? 'The repair uses most of your savings. The quiet relief of a dry kitchen helps soften the worry.' : 'Your savings cover the repair. You are relieved to have a dry kitchen and one less thing to worry about.', {
          joy: -3,
          health: 2
        }, {
          buffer: -14
        }), option2('diy', 'Try fixing it', 'With a borrowed tool and careful instructions, you stop the leak. The repair holds, and you gain a useful skill.', {
          learning: 8,
          joy: 3
        }, {
          buffer: -5,
          risk: {
            chance: 0.7,
            failure: {
              result: 'The leak gets worse despite your efforts. You call for help, keeping the lesson but paying more than you hoped.',
              delta: {
                learning: 4,
                joy: -7
              },
              buffer: -12
            }
          }
        }), option2('neighbor', 'Ask a neighbor', 'A neighbor arrives with tools and stays for tea afterward. You promise to return the favor when they need a hand.', {
          bonds: 10,
          learning: 4
        }, {
          buffer: -7
        }), option2('replace', 'Replace the pipe', 'You pay for a more thorough repair instead of a quick patch. It costs more now, but the plumbing is finally reliable.', {
          health: 4,
          joy: 3
        }, {
          buffer: -20
        }));
      case 9:
        return decision('Turning points', 'A busy year', 'A demanding project could open new doors, but your evenings are already full. You notice how often you have been saying you are tired.', option2('project', 'Take it on', 'The project pays well and stretches your abilities. When it ends, you realize how much rest you have been putting off.', {
          learning: 10,
          health: -9
        }, {
          buffer: 16
        }), option2('rest', 'Slow down', 'You turn down the extra work and protect your evenings. There is less money coming in, but you begin sleeping better.', {
          health: 12,
          joy: 6
        }, {
          buffer: -8
        }), option2('share', 'Share the work', 'You ask colleagues to split the responsibility. The reward is smaller, but so is the strain, and trust grows within the team.', {
          bonds: 8,
          learning: 5
        }, {
          buffer: 6
        }), option2('change', 'Change direction', 'You leave the familiar role for more independent work. The first months are uncertain, but your schedule feels like yours again.', {
          joy: 9,
          learning: 8
        }, {
          career: 'independent specialist',
          buffer: -10
        }));
      case 10:
        return decision('New paths', 'A change of scene', (value.companion || 'A friend') + ' has time for a break, and you realize how long it has been. You open an old map and begin imagining a change of scene.', option2('travel', 'Take a trip', value.buffer < 12 ? 'You find a short, low-cost escape. A new route and an unfamiliar breakfast are enough to make it memorable.' : 'You use some savings to visit somewhere new. You come home with stories that slip into conversation for years.', {
          joy: 10,
          bonds: 6
        }, {
          buffer: value.buffer < 12 ? -4 : -12
        }), option2('nearby', 'Stay nearby', 'You explore a familiar place without hurrying through it. A hidden path and a long lunch make an ordinary day feel new.', {
          joy: 6,
          bonds: 5,
          health: 3
        }, {
          buffer: -2
        }), option2('reunion', 'Plan a reunion', 'You invite old friends to bring food and photographs. Some stories have changed with time, but the laughter has not.', {
          bonds: 13,
          joy: 6
        }, {
          buffer: -6
        }), option2('alone', 'Go on your own', 'You take a quiet day to wander at your own pace. With no one else’s plans to follow, you notice what you have been missing.', {
          joy: 9,
          learning: 7
        }, {
          buffer: -5
        }));
      case 11:
        return decision('New paths', 'Still learning', 'Someone asks how you learned to do what you do. Their question makes you wonder what else you could still learn, or pass on.', option2('mentor', 'Be a mentor', 'You make time for a beginner’s questions. Watching their confidence grow reminds you of your own uncertain first days.', {
          bonds: 11,
          learning: 4
        }), option2('beginner', 'Try a new skill', 'You join a class where nobody knows your work or your history. Being clumsy at something new feels strangely freeing.', {
          joy: 9,
          learning: 8
        }), option2('community', 'Join a local group', 'You help organize a small neighborhood project. Working beside people of different ages brings new friendships.', {
          bonds: 10,
          health: 4
        }), option2('record', 'Write a guide', 'You turn years of trial and error into a short guide. Explaining the details helps you understand your own experience better.', {
          learning: 12,
          joy: 3
        }));
      case 12:
        return decision('Slowing down', 'More free time', 'Work begins to slow down, leaving open spaces in your calendar. At first the quiet is unfamiliar; then you begin to see possibilities.', option2('outside', 'Get outdoors', 'Long walks become a favorite habit. You learn the names of trees and start recognizing other regular walkers.', {
          health: 11,
          joy: 6
        }), option2('gather', 'Host dinner', 'You start inviting people over without waiting for an occasion. Your table becomes a regular meeting place.', {
          bonds: 13,
          joy: 5
        }), option2('volunteer', 'Give your time', 'You take a weekly shift helping a local group. Having somewhere to be, and someone expecting you, gives the week a gentle shape.', {
          bonds: 10,
          health: 5
        }), option2('create', 'Make something', 'An unfinished idea finally gets your attention. The project moves slowly, but there is pleasure in having time to do it well.', {
          learning: 8,
          joy: 9
        }, {
          buffer: -4
        }));
      case 13:
        return decision('Later years', 'Stories to keep', 'A box of old photos turns up while you are tidying. Some faces are still close; others belong to chapters you have not thought about in years.', option2('write', 'Write stories', 'You write the details that a photograph cannot hold. Someone asks for a copy, and then asks for another story.', {
          bonds: 8,
          learning: 6
        }), option2('new', 'Make new ones', 'You say yes to a small outing you might have skipped. The journey is tiring, but you are glad to have a new story to tell.', {
          health: 6,
          joy: 10
        }), option2('restore', 'Restore the photos', 'You carefully sort, label and repair the pictures. Forgotten names return, and the collection becomes easier to share.', {
          learning: 10,
          bonds: 5
        }), option2('reconnect', 'Reach out', 'You find an old friend’s number and make the call. The years between you shrink as you begin remembering together.', {
          bonds: 13,
          joy: 4
        }));
      default:
        return decision('Later years', 'A quiet morning', 'Morning light reaches the familiar corner of your room. Your pace is slower now, but there is still room in the day for something that matters.', option2('call', 'Call someone', 'A familiar voice fills the room. Neither of you has important news, and that is part of the comfort.', {
          bonds: 9,
          joy: 5
        }), option2('discover', 'Read old notes', 'An old idea sparks a new thought. You add a few lines in the margin, pleased that curiosity has stayed with you.', {
          learning: 9,
          joy: 5
        }), option2('garden', 'Tend a plant', 'You water a plant and turn it toward the light. Its newest leaf gives you something small to look forward to.', {
          health: 5,
          joy: 7
        }), option2('rest', 'Enjoy the quiet', 'You sit with a warm drink and let the morning unfold. For once, there is nothing you feel you should be doing instead.', {
          health: 7,
          joy: 4
        }));
    }
  }
  // Public statistical facts, transcribed from https://1in8b.life/en/c/ on 2026-10-20.
  // Reference attribution: UN World Population Prospects 2024, births in 2023.
  // Published country shares are rounded to two decimals. The homepage groups
  // the nine leading countries separately from the remaining 163 (49.5%).
  // Preserve those exact group odds; normalize rounding only WITHIN the Other group.
  // Four shares displayed as 0.00% retain a nonzero weight using published 1-in-N odds.
  const BIRTH_SOURCE = {
    url: 'https://1in8b.life/en/c/',
    dataset: 'UN WPP 2024',
    year: 2023,
    checked: '2026-10-20',
    precision: 'Published rounded shares; rare shares use published odds'
  };
  const rows = [['India', 17.6], ['China', 6.75], ['Nigeria', 5.69], ['Pakistan', 5.22], ['Indonesia', 3.4], ['DR Congo', 3.31], ['Ethiopia', 3.11], ['United States', 2.77], ['Bangladesh', 2.65], ['Brazil', 1.97], ['Egypt', 1.82], ['Tanzania', 1.78], ['Mexico', 1.54], ['Philippines', 1.4], ['Uganda', 1.3], ['Sudan', 1.27], ['Kenya', 1.14], ['Afghanistan', 1.11], ['Vietnam', 1.05], ['Yemen', 1.05], ['Angola', 1.05], ['Russia', 0.98], ['Mozambique', 0.96], ['South Africa', 0.9], ['Iran', 0.89], ['Iraq', 0.88], ['Niger', 0.83], ['Turkey', 0.81], ['Madagascar', 0.76], ["Côte d'Ivoire", 0.76], ['Cameroon', 0.73], ['Mali', 0.72], ['Uzbekistan', 0.72], ['Algeria', 0.69], ['Myanmar', 0.69], ['Ghana', 0.67], ['Chad', 0.62], ['Somalia', 0.6], ['Japan', 0.57], ['Burkina Faso', 0.55], ['Germany', 0.55], ['Colombia', 0.53], ['United Kingdom', 0.52], ['Zambia', 0.52], ['Malawi', 0.5], ['France', 0.48], ['Morocco', 0.48], ['Thailand', 0.45], ['Nepal', 0.44], ['Saudi Arabia', 0.41], ['Peru', 0.41], ['Senegal', 0.4], ['Syria', 0.4], ['Argentina', 0.38], ['Zimbabwe', 0.38], ['Guinea', 0.37], ['Benin', 0.36], ['Burundi', 0.35], ['Malaysia', 0.33], ['Venezuela', 0.32], ['Kazakhstan', 0.31], ['Rwanda', 0.3], ['Italy', 0.29], ['Guatemala', 0.29], ['Cambodia', 0.27], ['Canada', 0.27], ['North Korea', 0.26], ['Spain', 0.26], ['South Sudan', 0.25], ['Sri Lanka', 0.25], ['Poland', 0.24], ['Australia', 0.23], ['Tajikistan', 0.21], ['Ecuador', 0.2], ['Togo', 0.2], ['Bolivia', 0.2], ['Sierra Leone', 0.2], ['Haiti', 0.2], ['Papua New Guinea', 0.19], ['Central African Republic', 0.18], ['South Korea', 0.18], ['Jordan', 0.18], ['Honduras', 0.18], ['Ukraine', 0.16], ['Dominican Republic', 0.15], ['Republic of the Congo', 0.14], ['Romania', 0.14], ['Chile', 0.13], ['Mauritania', 0.13], ['Israel', 0.13], ['Liberia', 0.13], ['Netherlands', 0.13], ['Tunisia', 0.13], ['Laos', 0.12], ['Turkmenistan', 0.12], ['Kyrgyzstan', 0.11], ['Palestine', 0.11], ['Paraguay', 0.1], ['Taiwan', 0.1], ['Nicaragua', 0.1], ['Azerbaijan', 0.09], ['Libya', 0.09], ['United Arab Emirates', 0.08], ['Belgium', 0.08], ['El Salvador', 0.08], ['Eritrea', 0.08], ['Sweden', 0.07], ['Cuba', 0.07], ['Lebanon', 0.07], ['Czechia', 0.07], ['Portugal', 0.07], ['Hungary', 0.06], ['Oman', 0.06], ['Switzerland', 0.06], ['Gambia', 0.06], ['Austria', 0.06], ['Namibia', 0.06], ['Greece', 0.06], ['Panama', 0.05], ['Gabon', 0.05], ['Belarus', 0.05], ['Mongolia', 0.05], ['Guinea-Bissau', 0.05], ['Bulgaria', 0.05], ['Botswana', 0.05], ['Serbia', 0.05], ['New Zealand', 0.04], ['Denmark', 0.04], ['Lesotho', 0.04], ['Equatorial Guinea', 0.04], ['Ireland', 0.04], ['Slovakia', 0.04], ['Costa Rica', 0.04], ['Norway', 0.04], ['Kuwait', 0.04], ['Singapore', 0.04], ['Georgia', 0.03], ['Finland', 0.03], ['Hong Kong', 0.03], ['Armenia', 0.03], ['Uruguay', 0.03], ['Jamaica', 0.03], ['Moldova', 0.03], ['Croatia', 0.02], ['Timor-Leste', 0.02], ['Eswatini', 0.02], ['Qatar', 0.02], ['Albania', 0.02], ['Bosnia and Herzegovina', 0.02], ['Comoros', 0.02], ['Djibouti', 0.02], ['Solomon Islands', 0.02], ['Lithuania', 0.02], ['Kosovo', 0.02], ['Bahrain', 0.01], ['Slovenia', 0.01], ['North Macedonia', 0.01], ['Guyana', 0.01], ['Fiji', 0.01], ['Trinidad and Tobago', 0.01], ['Cyprus', 0.01], ['Latvia', 0.01], ['Mauritius', 0.01], ['Estonia', 0.01], ['Suriname', 0.01], ['Bhutan', 0.01], ['Montenegro', 0.01], ['Luxembourg', 0.01], ['Cabo Verde', 0, 20486], ['Maldives', 0, 22767], ['Macao', 0, 29221], ['Malta', 0, 31316]];
  const COUNTRY_BIRTH_SHARES = Object.freeze(rows.map(([name, share, odds]) => Object.freeze({
    name,
    share,
    weight: share || 100 / odds
  })));
  const colors = ['#6150a4', '#387b6b', '#a34e70', '#906a28', '#416a94', '#8060a6', '#427e8e', '#9a593d', '#5b7042'];
  const BIRTH_DISTRIBUTION = Object.freeze([...COUNTRY_BIRTH_SHARES.slice(0, 9).map((item, index) => Object.freeze({
    name: item.name,
    share: item.share,
    color: colors[index]
  })), Object.freeze({
    name: 'Other 163',
    fullName: 'Other 163 countries and regions',
    share: 49.5,
    color: '#a79bc4'
  })]);
  const other = COUNTRY_BIRTH_SHARES.slice(9);
  const otherTotal = other.reduce((total, item) => total + item.weight, 0);
  function sampleBirthplace(draw) {
    let value = draw() * 100;
    for (const country of BIRTH_DISTRIBUTION.slice(0, 9)) {
      value -= country.share;
      if (value < 0) return country.name;
    }
    value = draw() * otherTotal;
    for (const country of other) {
      value -= country.weight;
      if (value < 0) return country.name;
    }
    return other.at(-1).name;
  }
  const QUALITIES = [{
    id: 'health',
    label: 'Health',
    color: '#257467'
  }, {
    id: 'joy',
    label: 'Joy',
    color: '#A44D6B'
  }, {
    id: 'learning',
    label: 'Learning',
    color: '#6150A4'
  }, {
    id: 'bonds',
    label: 'Bonds',
    color: '#986720'
  }];
  const PLACES = [['Portugal', 'Porto', ['Inês', 'Tomás', 'Leonor']], ['Japan', 'Kyoto', ['Haru', 'Yuki', 'Ren']], ['Kenya', 'Nairobi', ['Amani', 'Imani', 'Zuri']], ['Brazil', 'Recife', ['Lia', 'Caio', 'Rafa']], ['India', 'Pune', ['Mira', 'Aarav', 'Isha']], ['Mexico', 'Mérida', ['Sol', 'Nico', 'Elena']], ['Canada', 'Halifax', ['Robin', 'Alex', 'Sage']], ['Vietnam', 'Da Nang', ['Linh', 'An', 'Minh']], ['Türkiye', 'İzmir', ['Deniz', 'Ece', 'Ada']], ['New Zealand', 'Dunedin', ['Jamie', 'Aria', 'Eden']], ['France', 'Lyon', ['Camille', 'Noé', 'Lou']], ['Ghana', 'Kumasi', ['Ama', 'Kofi', 'Esi']], ['China', 'Chengdu', ['Lin', 'Wei', 'Mei']], ['Nigeria', 'Lagos', ['Adaeze', 'Chidi', 'Tobi']], ['Pakistan', 'Lahore', ['Amina', 'Ali', 'Noor']], ['Indonesia', 'Bandung', ['Ayu', 'Dewi', 'Rizky']], ['DR Congo', 'Kinshasa', ['Elikia', 'Mado', 'Beni']], ['Ethiopia', 'Addis Ababa', ['Hana', 'Dawit', 'Selam']], ['United States', 'Portland', ['Jordan', 'Taylor', 'Casey']], ['Bangladesh', 'Dhaka', ['Asha', 'Rafi', 'Nila']]];
  const AGES = [0, 4, 8, 12, 16, 19, 24, 30, 36, 43, 50, 58, 66, 74, 82];
  const clamp = value => Math.max(0, Math.min(100, Math.round(value)));
  function random(value) {
    let value2 = value.rng += 1831565813;
    value2 = Math.imul(value2 ^ value2 >>> 15, value2 | 1);
    value2 ^= value2 + Math.imul(value2 ^ value2 >>> 7, value2 | 61);
    return ((value2 ^ value2 >>> 14) >>> 0) / 4294967296;
  }
  const pick2 = (value, otherValue) => otherValue[Math.floor(random(value) * otherValue.length)];
  function createLife(seed = Date.now()) {
    const options = {
      seed: seed >>> 0,
      rng: seed >>> 0,
      index: 0,
      phase: 'event',
      age: 0,
      started: true,
      stats: {
        health: 70,
        joy: 58,
        learning: 35,
        bonds: 55
      },
      buffer: 30,
      career: '',
      education: '',
      companion: '',
      memories: [],
      event: null,
      finished: false
    };
    const country = sampleBirthplace(() => random(options));
    const value = PLACES.find(item => item[0] === country);
    options.person = {
      country,
      city: value?.[1] || '',
      name: pick2(options, value?.[2] || ['Alex', 'Robin', 'Sam']),
      home: pick2(options, ['a busy apartment', 'a home above a little shop', 'a small house near a park']),
      family: pick2(options, ['a close-knit family', 'a lively, extended family', 'a quiet, caring household']),
      resources: pick2(options, ['money is tight', 'the basics are covered', 'there is a little to spare']),
      skin: pick2(options, ['#DBAA86', '#B47A58', '#845638']),
      shirt: pick2(options, ['#7262B4', '#388779', '#BD6E8B'])
    };
    for (const value2 of QUALITIES) options.stats[value2.id] = clamp(options.stats[value2.id] + Math.floor(random(options) * 17) - 8);
    // Fictional household resources are independent of location, not a country ranking.
    options.buffer = options.person.resources === 'money is tight' ? 22 : options.person.resources === 'the basics are covered' ? 40 : 60;
    options.finalAge = 84 + Math.floor(random(options) * 12);
    const resources = {
      'money is tight': 'Money is tight, but small celebrations matter.',
      'the basics are covered': 'The basics are covered, with little left for luxuries.',
      'there is a little to spare': 'There is a little to spare for treats and new experiences.'
    }[options.person.resources];
    options.event = {
      stage: 'A beginning',
      title: 'You’re born',
      body: 'You come home to ' + options.person.home + ' and ' + options.person.family + '. ' + resources,
      choices: [],
      deltas: {}
    };
    options.memories.push({
      age: 0,
      title: options.event.title,
      text: options.event.body,
      kind: 'birth'
    });
    return options;
  }
  // An unanswered decision cannot be skipped. Age advances only after its outcome.
  function advanceLife(value) {
    if (!value || value.phase !== 'event' || value.finished) return value;
    const next = structuredClone(value);
    if (next.index === AGES.length - 1) {
      next.phase = 'ended';
      next.finished = true;
      next.age = next.finalAge;
      return next;
    }
    next.index++;
    next.age = AGES[next.index];
    if (next.age >= 43) next.stats.health = clamp(next.stats.health - (next.age >= 66 ? 7 : 3));
    next.event = {
      ...decisionFor(next, pick2),
      deltas: {}
    };
    next.phase = 'choice';
    return next;
  }
  function chooseLife(value, otherValue) {
    if (!value || value.phase !== 'choice' || value.finished) return value;
    const choice = value.event.choices.find(item => item.id === otherValue);
    if (!choice) return value;
    const next = structuredClone(value);
    const before = {
      ...next.stats
    };
    const beforeBuffer = next.buffer;
    const outcome = choice.risk && random(next) >= choice.risk.chance ? {
      ...choice,
      ...choice.risk.failure
    } : choice;
    for (const value2 of QUALITIES) next.stats[value2.id] = clamp(next.stats[value2.id] + (outcome.delta[value2.id] || 0));
    next.buffer = clamp(next.buffer + (outcome.buffer || 0));
    for (const value2 of ['career', 'education', 'companion']) if (Object.prototype.hasOwnProperty.call(outcome, value2)) next[value2] = outcome[value2];
    const deltas = Object.fromEntries(QUALITIES.map(item => [item.id, next.stats[item.id] - before[item.id]]));
    deltas.savings = next.buffer - beforeBuffer;
    next.event = {
      ...next.event,
      body: outcome.result,
      choices: [],
      choice: choice.label,
      deltas
    };
    next.phase = 'event';
    next.memories.push({
      age: next.age,
      title: next.event.title,
      text: choice.label + '. ' + outcome.result,
      choice: choice.id,
      kind: 'choice'
    });
    return next;
  }
  function summary(value) {
    const best = [...QUALITIES].sort((leftItem, rightItem) => value.stats[rightItem.id] - value.stats[leftItem.id])[0];
    const titles = {
      health: 'A life in motion',
      joy: 'A joyful life',
      learning: 'A curious life',
      bonds: 'A connected life'
    };
    const endings = {
      health: 'You kept moving through change, finding a fresh path whenever an old one ended.',
      joy: 'You found joy in small things, turning ordinary days into memories worth keeping.',
      learning: 'You kept asking questions, staying curious long after your first lessons were over.',
      bonds: 'You made room for people, and the connections you nurtured became the heart of your life.'
    };
    return {
      title: titles[best.id],
      body: value.person.name + ' lived ' + value.finalAge + ' years. ' + endings[best.id],
      best: best.id
    };
  }
  // The roll is presentation only: the weighted model selects the winner first.
  // Its separate deterministic stream never consumes or changes the life's RNG.
  function makeBirthRoll(country, seed = 0, {
    reducedMotion = false
  } = {}) {
    let value = (seed ^ 1245296397) >>> 0;
    const next = () => {
      value = Math.imul(value, 1664525) + 1013904223 >>> 0;
      return value / 4294967296;
    };
    const names = COUNTRY_BIRTH_SHARES.map(item => item.name);
    const countries = [];
    const winnerIndex = 20;
    for (let value2 = 0; value2 < winnerIndex + 2; value2++) {
      let name = names[Math.floor(next() * names.length)];
      if (name === countries.at(-1)) name = names[(names.indexOf(name) + 1) % names.length];
      countries.push(name);
    }
    countries[winnerIndex] = country;
    for (const value2 of [winnerIndex - 1, winnerIndex + 1]) if (countries[value2] === country) countries[value2] = names[(names.indexOf(country) + value2) % names.length];
    return {
      countries,
      winnerIndex,
      rowHeight: 84,
      duration: reducedMotion ? 0 : 2300,
      hold: reducedMotion ? 250 : 950
    };
  }
  function birthRollState(roll, elapsed) {
    const progress = roll.duration ? Math.max(0, Math.min(1, elapsed / roll.duration)) : 1;
    const eased = 1 - Math.pow(1 - progress, 3);
    return {
      offset: -(roll.winnerIndex - 1) * roll.rowHeight * eased,
      landed: progress === 1,
      done: elapsed >= roll.duration + roll.hold
    };
  }
  const clamp2 = value => Math.max(0, Math.min(1, value));
  const smooth = value => {
    const value2 = clamp2(value);
    return value2 * value2 * (3 - 2 * value2);
  };

  // Presentation only. The next chapter is selected once, outside this timeline.
  function makeStageMotion(fromAge, toAge, {
    enterOnly = false,
    reducedMotion = false
  } = {}) {
    const from = Math.max(0, Math.round(fromAge));
    const toAge2 = Math.max(from, Math.round(toAge));
    const years = Array.from({
      length: toAge2 - from + 1
    }, (value, otherValue) => from + otherValue);
    return {
      fromAge: from,
      toAge: toAge2,
      years,
      rowHeight: 32,
      fadeOut: reducedMotion || enterOnly ? 0 : 150,
      fadeIn: reducedMotion ? 0 : 300,
      rollDuration: reducedMotion || enterOnly || from === toAge2 ? 0 : 640
    };
  }
  function stageMotionState(motion, elapsed) {
    const value = Math.max(0, elapsed);
    const committed = value >= motion.fadeOut;
    const ageProgress = motion.rollDuration ? clamp2((value - motion.fadeOut) / motion.rollDuration) : 1;
    const eased = 1 - Math.pow(1 - ageProgress, 3);
    const opacity = committed ? motion.fadeIn ? smooth((value - motion.fadeOut) / motion.fadeIn) : 1 : 1 - smooth(value / motion.fadeOut);
    return {
      committed,
      opacity,
      ageOffset: -(motion.years.length - 1) * motion.rowHeight * eased || 0,
      rolling: committed && ageProgress < 1,
      done: value >= motion.fadeOut + Math.max(motion.fadeIn, motion.rollDuration)
    };
  }
  const queryElement = value => document.querySelector(value);
  const root = queryElement('#game');
  const layout = queryElement('#layout');
  const query = new URLSearchParams(location.search);
  const choiceButtons = ['#choice-a', '#choice-b', '#choice-c', '#choice-d'].map(queryElement);
  const feed = query.has('review') || query.get('feedReview') === '1';
  let active = !feed;
  let life = null;
  let audio;
  let locked = false;
  let unlockTimer;
  let disposed = false;
  let lastFocus;
  let continueText = 'Continue';
  let rolling = null;
  let rollFrame = 0;
  let lastRollTime = null;
  let stageMotion = null;
  let stageFrame = 0;
  let lastStageTime = null;
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  root.dataset.feedPreview = String(!active);
  root.dataset.paused = 'false';
  const qualities = new Map();
  for (const value2 of BIRTH_DISTRIBUTION) {
    const element = document.createElement('li');
    const label = document.createElement('span');
    const track = document.createElement('span');
    const fill = document.createElement('span');
    const value = document.createElement('span');
    label.className = 'birth-country';
    label.textContent = value2.name;
    track.className = 'birth-track';
    track.setAttribute('aria-hidden', 'true');
    fill.className = 'birth-fill';
    fill.style.setProperty('--share', `${value2.share / 50 * 100}%`);
    fill.style.setProperty('--bar-color', value2.color);
    track.append(fill);
    value.className = 'birth-share';
    value.textContent = `${value2.share.toFixed(2)}%`;
    element.setAttribute('aria-label', `${value2.fullName || value2.name}: ${value.textContent}`);
    element.append(label, track, value);
    queryElement('#birth-bars').append(element);
  }
  for (const value2 of QUALITIES) {
    const item = document.createElement('div');
    item.className = 'quality';
    item.style.setProperty('--tone', value2.color);
    const label = document.createElement('span');
    label.className = 'quality-label';
    label.textContent = value2.label;
    const value = document.createElement('output');
    value.className = 'quality-value';
    const meter = document.createElement('div');
    meter.className = 'quality-meter';
    meter.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('span');
    fill.className = 'quality-fill';
    meter.append(fill);
    item.append(label, value, meter);
    queryElement('#qualities').append(item);
    qualities.set(value2.id, {
      item,
      value
    });
  }
  function resize() {
    const clientWidth = root.clientWidth;
    const clientHeight = root.clientHeight;
    if (!clientWidth || !clientHeight) return;
    const scale = Math.min(clientWidth / 390, clientHeight / 598);
    root.style.setProperty('--scale', scale);
    for (const value of [layout, queryElement('#opening'), queryElement('#birth-reveal')]) value.style.height = clientHeight / scale + 'px';
  }
  function sound(kind = 'next') {
    if (!active || document.hidden || disposed) return;
    try {
      const value = window.AudioContext || window.webkitAudioContext;
      if (!value) return;
      audio ??= new value();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      const currentTime = audio.currentTime;
      const notes = kind === 'end' ? [392, 494, 587] : kind === 'birth' ? [523, 659] : kind === 'roll' ? [294] : [392];
      const quiet = kind === 'roll';
      for (const [i, f] of notes.entries()) {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = f;
        gain.gain.setValueAtTime(0, currentTime + i * 0.06);
        gain.gain.linearRampToValueAtTime(quiet ? 0.008 : 0.018, currentTime + i * 0.06 + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + i * 0.06 + (quiet ? 0.09 : 0.22));
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(currentTime + i * 0.06);
        oscillator.stop(currentTime + i * 0.06 + (quiet ? 0.11 : 0.24));
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
      }
    } catch {}
  }
  function changes(deltas) {
    queryElement('#changes').replaceChildren();
    for (const value of [...QUALITIES, {
      id: 'savings',
      label: 'Savings'
    }]) {
      const item = deltas[value.id];
      if (!item) continue;
      const element = document.createElement('span');
      element.textContent = `${value.label} ${item > 0 ? '+' : ''}${item}`;
      if (item < 0) element.className = 'negative';
      queryElement('#changes').append(element);
    }
  }
  function updateAvailability() {
    for (const value of [queryElement('#birth'), queryElement('#continue'), queryElement('#another-life'), ...choiceButtons]) value.disabled = locked || !!rolling || !!stageMotion || !active;
    queryElement('#journal-button').disabled = !active || !!rolling || !!stageMotion;
    queryElement('#about-button').disabled = !active || !!rolling || !!stageMotion;
    queryElement('#layout').inert = !active || !!rolling;
    queryElement('#opening').inert = !active || !!rolling;
  }
  function render({
    focus = false
  } = {}) {
    const opening = !life && !rolling;
    root.dataset.phase = rolling ? rolling.landed ? 'birth-result' : 'drawing' : opening ? 'intro' : life.phase;
    root.dataset.started = String(!opening);
    root.dataset.age = life ? life.age : '';
    root.dataset.chapter = life ? life.index : '';
    root.dataset.ready = 'true';
    queryElement('#opening').hidden = !opening;
    queryElement('#birth-reveal').hidden = !rolling;
    layout.hidden = !life;
    if (rolling) {
      updateAvailability();
      resize();
      return;
    }
    if (opening) {
      queryElement('#announcement').textContent = '';
      updateAvailability();
      resize();
      return;
    }
    queryElement('#age-value').textContent = life.age;
    queryElement('#age').setAttribute('aria-label', `${life.age} years old`);
    queryElement('#name').textContent = life.person.name;
    queryElement('#place').textContent = [life.person.city, life.person.country].filter(Boolean).join(', ');
    queryElement('#life-path').replaceChildren();
    for (let value = 0; value < AGES.length; value++) {
      const element = document.createElement('i');
      element.className = value < life.index ? 'lived' : value === life.index ? 'now' : '';
      queryElement('#life-path').append(element);
    }
    for (const value2 of QUALITIES) {
      const {
        item,
        value
      } = qualities.get(value2.id);
      value.textContent = life.stats[value2.id];
      value.setAttribute('aria-label', `${value2.label} ${life.stats[value2.id]} out of 100`);
      item.style.setProperty('--value', life.stats[value2.id] + '%');
    }
    const choosing = life.phase === 'choice';
    queryElement('#choices').hidden = !choosing;
    queryElement('#continue').hidden = life.finished || choosing;
    queryElement('#another-life').hidden = !life.finished;
    queryElement('#changes').replaceChildren();
    let title;
    let body;
    if (life.finished) {
      const value = summary(life);
      title = value.title;
      body = value.body;
      queryElement('#chapter').textContent = 'Your life';
      queryElement('#step').textContent = '';
      const note = document.createElement('span');
      note.textContent = life.memories.length - 1 + ' choices';
      queryElement('#changes').append(note);
    } else {
      title = life.event.title;
      body = life.event.body;
      queryElement('#chapter').textContent = life.event.stage;
      queryElement('#step').textContent = `${life.index + 1} / ${AGES.length}`;
      changes(life.event.deltas);
      queryElement('#continue').textContent = continueText;
      queryElement('#continue').setAttribute('aria-label', life.index === AGES.length - 1 ? 'See your life summary' : `Continue to age ${AGES[life.index + 1]}`);
      if (choosing) for (const [i, button] of choiceButtons.entries()) {
        const option = life.event.choices[i];
        button.textContent = option.label;
        button.dataset.choice = option.id;
      }
    }
    queryElement('#event-title').textContent = title;
    queryElement('#event-body').textContent = body;
    queryElement('#announcement').textContent = `Age ${life.age}. ${title} ${body}`;
    updateAvailability();
    if (focus) queryElement('#story').focus({
      preventScroll: true
    });
    resize();
  }
  function guard(action) {
    if (!active || document.hidden || locked || disposed || rolling || stageMotion) return;
    action();
    locked = true;
    updateAvailability();
    clearTimeout(unlockTimer);
    unlockTimer = setTimeout(() => {
      locked = false;
      updateAvailability();
    }, 220);
  }
  function finishStage() {
    stageMotion = null;
    lastStageTime = null;
    root.dataset.transition = 'idle';
    queryElement('#story').style.opacity = '1';
    queryElement('#qualities').style.opacity = '1';
    queryElement('#story').setAttribute('aria-busy', 'false');
    queryElement('#age-window').hidden = true;
    queryElement('#age-value').style.visibility = '';
    queryElement('#age-reel').replaceChildren();
    updateAvailability();
    if (active && !document.hidden) queryElement('#story').focus({
      preventScroll: true
    });
  }
  function paintStage() {
    if (!stageMotion) return;
    const state = stageMotionState(stageMotion, stageMotion.elapsed);
    if (state.committed && !stageMotion.committed) {
      stageMotion.committed = true;
      life = stageMotion.nextLife;
      render();
      sound(life.finished ? 'end' : 'next');
    }
    root.dataset.transition = state.done ? 'idle' : state.committed ? 'in' : 'out';
    queryElement('#story').style.opacity = String(state.opacity);
    queryElement('#qualities').style.opacity = String(state.opacity);
    const showYears = state.committed && stageMotion.years.length > 1;
    queryElement('#age-window').hidden = !showYears;
    queryElement('#age-value').style.visibility = showYears ? 'hidden' : '';
    queryElement('#age-reel').style.transform = `translate3d(0,${state.ageOffset}px,0)`;
    if (state.done) finishStage();
  }
  function scheduleStage() {
    if (stageMotion && !stageFrame && active && !document.hidden && !disposed && root.dataset.paused !== 'true') stageFrame = requestAnimationFrame(tickStage);
  }
  function tickStage(value) {
    stageFrame = 0;
    if (!stageMotion || !active || document.hidden || disposed || root.dataset.paused === 'true') {
      lastStageTime = null;
      return;
    }
    if (lastStageTime !== null) stageMotion.elapsed += Math.max(0, value - lastStageTime);
    lastStageTime = value;
    paintStage();
    scheduleStage();
  }
  function beginStage(nextLife, {
    enterOnly = false
  } = {}) {
    stageMotion = {
      ...makeStageMotion(life.age, nextLife.age, {
        enterOnly,
        reducedMotion: motionPreference.matches
      }),
      nextLife,
      elapsed: 0,
      committed: enterOnly
    };
    lastStageTime = null;
    queryElement('#age-reel').replaceChildren();
    for (const value of stageMotion.years) {
      const element = document.createElement('span');
      element.className = 'age-year';
      element.textContent = value;
      queryElement('#age-reel').append(element);
    }
    queryElement('#story').setAttribute('aria-busy', 'true');
    paintStage();
    updateAvailability();
    scheduleStage();
  }
  function scheduleRoll() {
    if (rolling && !rollFrame && active && !document.hidden && !disposed && root.dataset.paused !== 'true') rollFrame = requestAnimationFrame(tickRoll);
  }
  function tickRoll(value) {
    rollFrame = 0;
    if (!rolling || !active || document.hidden || disposed || root.dataset.paused === 'true') {
      lastRollTime = null;
      return;
    }
    if (lastRollTime !== null) rolling.elapsed += Math.max(0, value - lastRollTime);
    lastRollTime = value;
    const state = birthRollState(rolling, rolling.elapsed);
    queryElement('#country-reel').style.transform = `translate3d(0,${state.offset}px,0)`;
    if (state.landed && !rolling.landed) {
      rolling.landed = true;
      root.dataset.phase = 'birth-result';
      queryElement('#birth-result').textContent = `You are born in ${rolling.life.person.country}.`;
      sound('birth');
    }
    if (state.done) {
      life = rolling.life;
      rolling = null;
      lastRollTime = null;
      queryElement('#birth-result').textContent = '';
      render();
      beginStage(life, {
        enterOnly: true
      });
      return;
    }
    scheduleRoll();
  }
  function born() {
    guard(() => {
      const seed = crypto.getRandomValues(new Uint32Array(1))[0];
      const pending = createLife(seed);
      rolling = {
        ...makeBirthRoll(pending.person.country, seed, {
          reducedMotion: motionPreference.matches
        }),
        life: pending,
        elapsed: 0,
        landed: false
      };
      queryElement('#country-reel').replaceChildren();
      for (const [i, name] of rolling.countries.entries()) {
        const element = document.createElement('div');
        element.className = 'roll-country';
        element.textContent = name;
        element.dataset.winner = String(i === rolling.winnerIndex);
        queryElement('#country-reel').append(element);
      }
      queryElement('#country-reel').style.transform = 'translate3d(0,0,0)';
      queryElement('#birth-result').textContent = '';
      queryElement('#announcement').textContent = 'Finding your birthplace.';
      lastRollTime = null;
      sound('roll');
      render();
      scheduleRoll();
    });
  }
  function reduceMotion() {
    if (!motionPreference.matches) return;
    if (rolling) {
      rolling.duration = 0;
      rolling.hold = 250;
      rolling.elapsed = 0;
      lastRollTime = null;
      scheduleRoll();
    }
    if (stageMotion) {
      Object.assign(stageMotion, makeStageMotion(stageMotion.fromAge, stageMotion.toAge, {
        reducedMotion: true
      }));
      stageMotion.elapsed = 0;
      lastStageTime = null;
      scheduleStage();
    }
  }
  function onward() {
    guard(() => {
      if (!life || life.phase !== 'event' || life.finished) return;
      beginStage(advanceLife(life));
    });
  }
  function selectChoice(value) {
    guard(() => {
      const next = chooseLife(life, value);
      if (next !== life) beginStage(next);
    });
  }
  function restart() {
    guard(() => {
      life = null;
      render();
      queryElement('#birth').focus({
        preventScroll: true
      });
    });
  }
  queryElement('#birth').addEventListener('click', born);
  queryElement('#continue').addEventListener('click', onward);
  queryElement('#another-life').addEventListener('click', restart);
  for (const value of choiceButtons) value.addEventListener('click', () => selectChoice(value.dataset.choice));
  function openDialog(value) {
    if (!active || !life || disposed) return;
    lastFocus = document.activeElement;
    if (value === 'journal') {
      queryElement('#journal-person').textContent = [life.person.name + ' · ' + life.person.country, 'Savings: ' + life.buffer + '/100', life.education ? 'Study: ' + life.education : '', life.career ? 'Work: ' + life.career : '', life.companion ? 'Partner: ' + life.companion : ''].filter(Boolean).join('\n');
      queryElement('#memories').replaceChildren();
      for (const memory of life.memories) {
        const element = document.createElement('li');
        const element2 = document.createElement('span');
        const title = document.createElement('strong');
        const text = document.createElement('p');
        element2.className = 'memory-age';
        element2.textContent = `Age ${memory.age}`;
        title.textContent = memory.title;
        text.textContent = memory.text;
        element.append(element2, title, text);
        queryElement('#memories').append(element);
      }
    }
    queryElement('#' + value).showModal();
  }
  function closeDialog(value) {
    queryElement('#' + value).close();
    if (lastFocus?.isConnected) lastFocus.focus({
      preventScroll: true
    });else queryElement('#journal-button').focus({
      preventScroll: true
    });
  }
  for (const value of document.querySelectorAll('[data-close]')) value.addEventListener('click', () => closeDialog(value.dataset.close));
  for (const element of document.querySelectorAll('dialog')) element.addEventListener('click', event => {
    if (event.target !== element) return;
    const bounds = element.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(element.id);
  });
  queryElement('#journal-button').addEventListener('click', () => openDialog('journal'));
  queryElement('#about-button').addEventListener('click', () => openDialog('about'));
  queryElement('#retry').addEventListener('click', () => location.reload());
  function pause() {
    root.dataset.paused = 'true';
    if (rollFrame) cancelAnimationFrame(rollFrame);
    if (stageFrame) cancelAnimationFrame(stageFrame);
    rollFrame = 0;
    stageFrame = 0;
    lastRollTime = null;
    lastStageTime = null;
    audio?.suspend().catch(() => {});
  }
  function resume() {
    if (!disposed && !document.hidden && active) {
      root.dataset.paused = 'false';
      scheduleRoll();
      scheduleStage();
    }
  }
  function visibility() {
    if (document.hidden) {
      pause();
    } else {
      resume();
    }
  }
  function receive(value) {
    if (value.source !== parent || value.origin !== location.origin || value.data?.type !== 'playable-active') return;
    active = value.data.active === true;
    root.dataset.feedPreview = String(!active);
    if (!active) {
      for (const value2 of document.querySelectorAll('dialog[open]')) value2.close();
      pause();
    } else resume();
    render();
  }
  function dispose() {
    disposed = true;
    clearTimeout(unlockTimer);
    if (rollFrame) cancelAnimationFrame(rollFrame);
    if (stageFrame) cancelAnimationFrame(stageFrame);
    rollFrame = 0;
    stageFrame = 0;
    rolling = null;
    stageMotion = null;
    motionPreference.removeEventListener('change', reduceMotion);
    observer.disconnect();
    audio?.close().catch(() => {});
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('message', receive);
    window.removeEventListener('blur', pause);
    window.removeEventListener('focus', resume);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(root);
  motionPreference.addEventListener('change', reduceMotion);
  window.addEventListener('message', receive);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('blur', pause);
  window.addEventListener('focus', resume);
  window.addEventListener('pagehide', dispose, {
    once: true
  });
  async function loadGuide() {
    let config;
    try {
      config = await (await fetch('./game.config.json', {
        cache: 'no-store'
      })).json();
    } catch {
      try {
        config = JSON.parse(queryElement('#playable-inline-config')?.textContent || '{}');
      } catch {
        config = {};
      }
    }
    const value = config.texts?.find(value2 => value2.id === 'HINT_TEXT')?.value;
    if (typeof value === 'string' && value.trim()) continueText = value;
    queryElement('#continue').textContent = continueText;
  }
  try {
    render();
    loadGuide();
  } catch (value) {
    console.warn('One Life could not load', value);
    queryElement('#load-error').hidden = false;
  }
}
function App() {
  React.useLayoutEffect(() => {
    mountOneLife();
  }, []);
  return <> <main id={"game"} aria-label={"One Life, a fictional life simulator"}><section id={"opening"} aria-labelledby={"opening-title"}><div className={"opening-heading"}><h1 id={"opening-title"}>{"One Life"}</h1><p>{"Where will you be born?"}</p></div><div id={"birth-chart"} role={"group"} aria-label={"Birth probability by country"}><ul id={"birth-bars"} aria-label={"Birth probabilities"}></ul><div className={"birth-axis"} aria-hidden={"true"}><span>{"0%"}</span><span>{"Chance of birth"}</span><span>{"50%"}</span></div></div><button id={"birth"}>{"Be born"}</button></section><section id={"birth-reveal"} aria-labelledby={"reveal-title"} hidden={true}><h2 id={"reveal-title"}>{"You’ll be born in"}</h2><div id={"country-window"} aria-hidden={"true"}><div id={"country-reel"}></div></div><output id={"birth-result"} className={"sr-only"} role={"status"} aria-live={"polite"}></output></section><div id={"layout"} hidden={true}><header><div id={"age-block"}><output id={"age"} aria-label={"Age"} aria-live={"off"}><span id={"age-value"}>{"0"}</span><span id={"age-window"} aria-hidden={"true"} hidden={true}><span id={"age-reel"}></span></span></output><span>{"years old"}</span></div><div id={"identity"}><strong id={"name"}></strong><span id={"place"}></span></div><button id={"journal-button"} aria-label={"Your journal"}><svg viewBox={"0 0 24 24"} aria-hidden={"true"}><path d={"M4 3h15v18H4zM8 3v18M11 8h5m-5 4h5"}></path></svg></button></header><section id={"qualities"} aria-label={"Your qualities, out of 100"}></section><section id={"story"} tabIndex={"-1"} aria-labelledby={"event-title"}><div className={"story-top"}><span id={"chapter"}></span><span id={"step"} aria-label={"Chapter progress"}></span></div><h2 id={"event-title"}></h2><p id={"event-body"}></p><div id={"changes"} aria-label={"Changes from this event"}></div></section><div id={"actions"}><div id={"choices"} role={"group"} aria-label={"Choose your path"} hidden={true}><button id={"choice-a"}></button><button id={"choice-b"}></button><button id={"choice-c"}></button><button id={"choice-d"}></button></div><button id={"continue"}>{"Continue"}</button><button id={"another-life"} hidden={true}>{"Another life"}</button></div><div id={"life-path"} aria-hidden={"true"}></div></div><p id={"announcement"} className={"sr-only"} role={"status"} aria-live={"polite"}></p><dialog id={"journal"} aria-labelledby={"journal-title"}><div className={"dialog-head"}><h2 id={"journal-title"}>{"Your life"}</h2><button data-close={"journal"} aria-label={"Close journal"}>{"×"}</button></div><p id={"journal-person"}></p><ol id={"memories"}></ol><button id={"about-button"}>{"About"}</button><button className={"dialog-done"} data-close={"journal"}>{"Back to life"}</button></dialog><dialog id={"about"} aria-labelledby={"about-title"}><div className={"dialog-head"}><h2 id={"about-title"}>{"About One Life"}</h2><button data-close={"about"} aria-label={"Close information"}>{"×"}</button></div><p>{"Birth odds cover 172 countries and regions."}</p><p>{"Source: UN WPP 2024, births in 2023, via 1in8b.life. Rounded shares and 1-in-N odds."}</p><p>{"People, events, stats and lifespan are fictional. Choose a path, then continue. Nothing is saved online."}</p><button className={"dialog-done"} data-close={"about"}>{"Back to life"}</button></dialog><div id={"load-error"} hidden={true} role={"alert"}><p>{"The story could not load."}</p><button id={"retry"}>{"Try again"}</button></div></main> </>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = [];
  const copy = new Set(["Continue"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Map();
  let queued = false;
  let visible = true;
  const action = /^(?:(?:tap|drag|hold|swipe|draw|use|press|click|release|brush|pull|touch|pinch|rub|move|trace)\b|spray\s*[→-]|tocca\b|trascina\b|tieni\b|scorri\b|disegna\b|premi\b|点击|轻触|滑动|按住|拖动|长按|双击)/i;
  function scan() {
    queued = false;
    for (const [el, a] of running) if (!el.isConnected) {
      a.cancel();
      running.delete(el);
    }
    if (motion.matches) {
      for (const value of running.values()) value.cancel();
      running.clear();
      return;
    }
    const targets = new Set();
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach(item => targets.add(item));
      } catch {}
    }
    for (const value of document.querySelectorAll('p,span,div,label,text')) {
      if (value.children.length || value.closest('button,a,input,select,textarea,[role="button"]')) continue;
      const text = (value.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 5 && text.length <= 140 && (copy.has(text.toLowerCase()) || !selectors.length && action.test(text))) targets.add(value);
    }
    for (const value of targets) {
      if (running.has(value) || typeof value.animate !== 'function') continue;
      if ([...targets].some(child => child !== value && value.contains(child))) continue;
      const style = getComputedStyle(value);
      if (/breath/i.test(style.animationName)) continue;
      const base = style.filter.replace(/opacity\([^)]*\)/g, '').replace(/^none$/, '').trim();
      const filter = value3 => (base ? base + ' ' : '') + 'opacity(' + value3 + ')';
      const value2 = value.animate([{
        filter: filter(1)
      }, {
        filter: filter(0.65)
      }, {
        filter: filter(1)
      }], {
        duration: 2400,
        iterations: Infinity,
        easing: 'ease-in-out'
      });
      running.set(value, value2);
      if (document.hidden || !visible) value2.pause();
    }
  }
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(scan);
    }
  };
  const pause = () => {
    for (const value of running.values()) {
      if (document.hidden || !visible) {
        value.pause();
      } else {
        value.play();
      }
    }
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
  const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    visible = entries.some(item => item.isIntersecting);
    pause();
  }) : null;
  if (document.body) intersection?.observe(document.body);else document.addEventListener('DOMContentLoaded', () => intersection?.observe(document.body), {
    once: true
  });
  document.addEventListener('visibilitychange', pause);
  motion.addEventListener?.('change', schedule);
  schedule();
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    intersection?.disconnect();
    for (const value of running.values()) value.cancel();
    running.clear();
  }, {
    once: true
  });
})();

// Game helper

/* Batch 3 entry polish. Preview covers are still images in the feed. */
(() => {
  'use strict';

  const number = Number({
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "data-game": "",
        "data-batch3-game": "73"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "73"
    }
  }?.dataset.batch3Game);
  const isFeed = new URLSearchParams(location.search).get('feedReview') === '1' && window.parent !== window;
  const root = document.documentElement;
  root.toggleAttribute('data-batch3-preview', isFeed);
  const configurations = {
    12: {
      text: 'Tap to pop the bubbles',
      top: '80px',
      color: '#a2355a',
      action: 'bubble'
    },
    20: {
      text: 'Tap the bug',
      top: '32%',
      color: '#fff',
      action: 'bug'
    },
    27: {
      text: 'Guess their age',
      top: '10.5%',
      color: '#fff',
      action: 'age'
    },
    37: {
      text: 'Tap to add balls',
      top: '24%',
      color: '#fff',
      action: 'add-ball'
    },
    39: {
      text: 'Tap squares to find the animal',
      top: '22%',
      color: '#29202e',
      action: 'cell'
    },
    49: {
      text: 'Guess the hidden code',
      top: '40%',
      color: '#fff',
      action: 'digit'
    },
    60: {
      text: 'Steer into the parking spot',
      top: '34%',
      color: '#fff',
      action: 'drive'
    }
  };
  const previewCSS = {
    8: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    11: 'html[data-batch3-preview] .screen-container div:has(>button.btn-option){transform:translateY(-8vh) scale(.84);transform-origin:center center}',
    13: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    25: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    27: 'html[data-batch3-preview] .age-controls {transform:translateY(-16vh) scale(.9);transform-origin:bottom center}',
    30: 'html[data-batch3-preview] .btn-control {visibility:hidden!important}',
    34: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    37: 'html[data-batch3-preview] #root button {bottom:34%!important}',
    38: 'html[data-batch3-preview] .pendulum-actions {visibility:hidden!important}',
    39: 'html[data-batch3-preview] [aria-label="8 by 8 animal search map"] {transform:scale(.84);transform-origin:center top}',
    43: 'html[data-batch3-preview] .meme-controls {visibility:hidden!important}',
    48: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    49: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    52: 'html[data-batch3-preview] .fate-wheel-wrap {transform:scale(.84)}',
    54: 'html[data-batch3-preview] .control {visibility:hidden!important}',
    56: 'html[data-batch3-preview] .drive-controls {visibility:hidden!important}',
    60: 'html[data-batch3-preview] #root div:has(>div>button[aria-label="Steer left"]) {visibility:hidden!important}',
    73: 'html[data-batch3-preview] #opening .opening-heading p {animation:b3-breathe 2.4s ease-in-out infinite}',
    74: 'html[data-batch3-preview] #photo-controls {visibility:hidden!important}'
  };
  const sharedCSS = `
    .b3-guide{position:fixed;left:30px;right:30px;z-index:120;margin:0;text-align:center;
      font:700 18px/1.3 var(--font-display,system-ui,sans-serif);pointer-events:none;
      text-shadow:0 1px 3px rgba(0,0,0,.25);animation:b3-breathe 2.4s ease-in-out infinite}
    @keyframes b3-breathe{0%,100%{opacity:1}50%{opacity:.68}}
    html[data-b3-hidden] .b3-guide,html[data-b3-hidden] #opening .opening-heading p{animation-play-state:paused!important}
    @media(prefers-reduced-motion:reduce){.b3-guide,html[data-batch3-preview] #opening .opening-heading p{animation:none!important}}
    ${previewCSS[number] || ''}
  `;
  const style = document.createElement('style');
  style.setAttribute('data-batch3-polish', '');
  style.textContent = sharedCSS;
  document.head.append(style);
  let guide;
  let dismissed = false;
  const config = configurations[number];
  function mountGuide() {
    if (!config || guide || dismissed) return;
    guide = document.createElement('p');
    guide.className = 'b3-guide';
    guide.textContent = config.text;
    guide.style.top = config.top;
    guide.style.color = config.color;
    document.body.append(guide);
  }
  function meaningful(event) {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (config?.action === 'bug') return !!target.closest('#root div[tabindex="0"]');
    if (config?.action === 'bubble') {
      if (target.closest('#root div[tabindex="0"],#root canvas')) return true;
      const value = target.closest('button');
      return !!value && /^(Sand Art|Spinner)$/.test(value.textContent.trim());
    }
    if (config?.action === 'age') return !!target.closest('input[type="range"],button.guess');
    const button = target.closest('button');
    if (!button || button.disabled) return false;
    if (config?.action === 'add-ball') return button.textContent.trim() === 'Add Ball';
    if (config?.action === 'cell') return /^Check cell \d+$/.test(button.getAttribute('aria-label') || '');
    if (config?.action === 'digit') return /^\d$/.test(button.textContent.trim());
    if (config?.action === 'drive') return /^(Steer left|Steer right|Drive forward|Reverse)$/.test(button.getAttribute('aria-label') || '');
    return false;
  }
  function dismissOnAction(event) {
    if (root.hasAttribute('data-batch3-preview')) return;
    if (meaningful(event)) {
      dismissed = true;
      guide?.remove();
      guide = null;
    }
  }
  document.addEventListener('pointerdown', dismissOnAction, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') dismissOnAction(event);
  }, true);
  window.addEventListener('message', event => {
    if (!isFeed || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    root.toggleAttribute('data-batch3-preview', event.data.active !== true);
  });
  document.addEventListener('visibilitychange', () => {
    root.toggleAttribute('data-b3-hidden', document.hidden);
  });
  const observer = new MutationObserver(mountGuide);
  const start = () => {
    mountGuide();
    observer.observe(document.getElementById('root') || document.body, {
      childList: true,
      subtree: true
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {
    once: true
  });else start();
  window.addEventListener('pagehide', () => {
    observer.disconnect();
  }, {
    once: true
  });
})();

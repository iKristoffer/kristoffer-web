// ---------------------------------------------------------------------------
// Historie: NPC'er, quest-linjer og dialog. Ren data + funktioner uden three.js,
// så teksten kan rettes uden at røre spillets motor (src/main.js).
//
// Dialog = en funktion af quest-tilstand (S.q.<linje> = trin) og taske. Den returnerer en node:
//   { lines: [tekst, ...], options: [{ label, disabled?, act? }] }
// `act` kører ved tryk og kan returnere en ny node (samtalen fortsætter) eller intet (den lukkes).
//
// Rød tråd: Ukaleq, den gamle syerske, venter på sin mand Ittu, som ikke kom hjem fra fangst. Han var en
// forsigtig mand og gemte sine bedste ting i jorden rundt om på øen. Hans spor er spillets følelsesmæssige
// kerne; varderne er ekspeditionens rute. NPC'erne er opdigtede — de virkelige personer (Knud, Miteq)
// optræder kun i dagbogsteksterne.
// ---------------------------------------------------------------------------

export const NPC_DEFS = {
    ukaleq: {
        name: 'Ukaleq',
        role: 'Gammel syerske · Ittus kone',
        icon: '👵',
        // Farver til samme model som Arnarulunnguaq, så de kan kendes fra hinanden
        colors: { coat: '#4f6d8c', pants: '#3b2c22', boots: '#e4dccb', bead: '#d99a2b', bead2: '#2f8f80', skin: '#b98a63' },
        place: 'camp',
    },
    nuka: {
        name: 'Nuka',
        role: 'Ung fanger · brækket ben',
        icon: '🧑',
        colors: { coat: '#7a4a32', pants: '#2c2a30', boots: '#5a4636', bead: '#2f8f80', bead2: '#c9402a', skin: '#c19068' },
        place: 'shore',
    },
    pavia: {
        name: 'Pavia',
        role: 'Hundekører',
        icon: '🧓',
        colors: { coat: '#5e5a4c', pants: '#3b2c22', boots: '#d8cfbf', bead: '#c9402a', bead2: '#d99a2b', skin: '#b4835c' },
        place: 'land',
    },
    qillaq: {
        name: 'Qillaq',
        role: 'Fortæller · eneboer ved fuglefjeldet',
        icon: '🧙',
        colors: { coat: '#cfc7b4', pants: '#4a4036', boots: '#8a7a62', bead: '#e9dfc8', bead2: '#2c86b0', skin: '#a9784f' },
        place: 'bird',
    },
};

/** Opskrifter, der er låst fra start, og et vink om hvor man finder dem (vises i Byg-panelet). */
export const RECIPE_HINTS = {
    kamik: 'Noget varmt til fødderne. Den gamle syerske i lejren kender håndværket.',
    anorak: 'Et varmere skind at have på. Spørg dem, der syr.',
    lamp: 'Et lys, der kan brænde hele natten. Syerskens gamle kunst.',
    kamik2: 'Dobbelte såler holder fødderne tørre. Ittus måde at sy på.',
    anorak2: 'Pels ind og pels ud. Ittus måde at sy på.',
    harpoon2: 'En bedre spids til harpunen. Den unge fanger kender den – ellers ligger der en tegning ude på øen.',
    harpoon3: 'En spids af hvaltand. Fortælleren inde i fuglefjeldet kender skaftet.',
    sled2: 'Hundekøreren ved, hvordan man gør slæden stærkere – hvis Siku stoler på dig.',
    axe: 'Noget til at hugge i is. Ittu gemte tegningen i jorden – Siku kan lugte den.',
    axe2: 'En skarpere økse til tyk is. Den unge fangers far lavede en.',
    lantern: 'En lampe, man kan bære ved hoften. Ukaleq kender den, når du har lært den gamle lampe.',
    cleats: 'Tænder under sålen til stejl is. Ittu gemte tegningen et sted, hvor kun hunde kommer ind.',
};

/** Fund i landskabet. `zone`: 'start' = inde i det afgrænsede startområde, ellers hvor som helst på øen. */
export const POIS = [
    { id: 'tent_ring', kind: 'trace', zone: 'start', icon: '⛺', name: 'Gammel teltring', title: '⛺ En gammel teltring',
      text: 'Sten i en ring, hvor et telt har stået. Under en flad sten ligger en nål af knogle og lidt sene, glemt af den, der brød op. Nogen har overvintret her før dig.', reward: { bone: 1, sinew: 1, brand: 1 } },
    { id: 'sled_marks', kind: 'trace', zone: 'start', icon: '🛷', name: 'Slædespor', title: '🛷 Slædespor og et afbrudt bål',
      text: 'Dybe furer i sneen og et bål, der blev slukket i hast. Hundene måtte trække hårdt – og nogen havde travlt. Sporene fører mod vest.', reward: { wood: 2, brand: 2 } },
    { id: 'whale_arch', kind: 'find', zone: 'start', icon: '🦴', name: 'Hvalbuen', title: '🦴 Hvalbuen',
      text: 'To ribben, rejst som en port. De gamle satte dem op, hvor de ville mindes en fangst. Der er hakkemærker i knoglen, og under dem et hul i sneen, hvor en kasse har stået.', reward: { bone: 2 } },
    { id: 'lost_mitten', kind: 'trace', zone: 'wide', icon: '🧤', name: 'Tabt vante', title: '🧤 En enlig vante',
      text: 'Sælskind, endnu blødt. Den kan ikke have ligget her længe. Hvem tabte den – og hvorfor gik de ikke tilbage efter den?', reward: { hide: 1 } },
    { id: 'tupilak', kind: 'find', zone: 'wide', icon: '🗿', name: 'Skåret figur', title: '🗿 En lille figur af tand',
      text: 'Nogen har skåret en beskyttende figur og gemt den i en sprække. Under den ligger en tegning i sod: en harpunspids med en knoglekant. Du kan lave den.', reward: {}, recipe: 'harpoon2' },
    { id: 'kayak_wreck', kind: 'trace', zone: 'wide', icon: '🛶', name: 'Kajakvrag', title: '🛶 Resterne af en kajak',
      text: 'Skindet er revet af, men stellet af drivtømmer er helt. Isen tog den, ikke mennesket – der er ingen spor, der fører væk.', reward: { wood: 3, sinew: 1 } },
    { id: 'cold_camp', kind: 'trace', zone: 'wide', icon: '🔥', name: 'Slukket lejrplads', title: '🔥 En lejrplads, kold i mange dage',
      text: 'Sod og tre brændte knogler. En fangstmand har haft dagens bytte her og gemt resten: kød og spæk, pakket i skind, og et par tjærede brande til fakler.', reward: { meat: 2, blubber: 1, brand: 2 } },
    { id: 'page', kind: 'trace', zone: 'wide', icon: '📄', name: 'Sammenkrøllet papir', title: '📄 Et stykke papir',
      text: '“Vi mistede en slæde ved revnen i går. Vi går videre mod vest, før vejret vender. Hvis nogen finder dette: følg varderne.” Resten er revet af af vinden.', reward: {} },
    { id: 'bird_rock', kind: 'find', zone: 'wide', icon: '🐦', name: 'Fuglesten', title: '🐦 En sten hvidtet af fugle',
      text: 'Hele stenen er hvid af fuglegødning, og lyngen omkring den er tæt af bær. Fuglene kommer her hver sommer – nu er der kun bærrene tilbage.', reward: { berries: 4 } },
    { id: 'ice_cave', kind: 'find', zone: 'wide', icon: '🧊', name: 'Blå isgrotte', title: '🧊 En lille grotte af blå is',
      text: 'Lyset trænger ind som gennem glas. Her er stille, og vinden når ikke ind. Du hakker et par rene blokke løs.', reward: { snow: 6 } },
];

// ---------------------------------------------------------------------------
// Opgaver. S.q.map: 0 ukendt · 1 find kortskindet · 2 bring det til Ukaleq · 3 smelt driven · 4 driven er væk · 5 afsluttet
//          S.q.needle: 0 ikke begyndt · 1 kamikker · 2 anorak · 3 lampe · 4 færdig (5 = dobbeltsåler lært, 6 = alt lært)
//          S.q.ittu: 0 ikke begyndt · 1 første gemme · 2 anden gemme · 3 fortæl Ukaleq · 4 afsluttet
// ---------------------------------------------------------------------------
const MAP_GOAL = [
    'Tal med Ukaleq i lejren',
    'Find Ukaleqs kortskind under Hvalbuen (følg pilen)',
    'Bring kortskindet tilbage til Ukaleq',
    'Smelt snedriven i passet: byg et bål helt tæt på den (følg pilen)',
    'Tal med Ukaleq – passet er åbent',
];
const NEEDLE_GOAL = [
    null,
    'Bring Ukaleq 2 skind og 2 sener (harer og sæler giver dem)',
    'Bring Ukaleq 3 skind, 2 sener og 1 knogle',
    'Bring Ukaleq 3 sten og 2 spæk – og hav et bål tændt',
];
const ITTU_GOAL = [
    null,
    'Find Ittus første gemme i Tyndisen: styr Siku (Q) gennem sprækken',
    'Find Ittus anden gemme ved Fuglefjeldet: Siku skal trække i rebet i Tyndisen',
    'Fortæl Ukaleq, hvad du fandt',
];

const NUKA_GOAL = [null, 'Bring Nuka 3 kød (rå eller kogt) til hans søsters børn', 'Fang 2 sæler ved åndehullerne og fortæl Nuka, hvordan det gik'];
const PAVIA_GOAL = [null, 'Vind Sikus tillid: klap og fodr hende, til tilliden er over 80 % – og tal så med Pavia'];
const QILLAQ_GOAL = [null, 'Find tre varder og fortæl Qillaq, hvad der stod i dem'];

/** Den aktive opgave som én linje til HUD'en, eller null. Kortopgaven går forud; derefter den, der er længst fremme. */
export function goalText(S) {
    if (S.q.map < 5) return MAP_GOAL[S.q.map];
    if (S.q.ittu >= 1 && S.q.ittu <= 3) return ITTU_GOAL[S.q.ittu];
    if (S.q.nuka >= 1 && S.q.nuka <= 2) return NUKA_GOAL[S.q.nuka];
    if (S.q.pavia === 1) return PAVIA_GOAL[1];
    if (S.q.qillaq === 1) return QILLAQ_GOAL[1];
    return NEEDLE_GOAL[S.q.needle] || null;
}

/** Hvilken NPC pilen skal pege på, mens opgaven kræver at man taler med en. */
export function targetNpc(S) {
    if (S.q.map === 0 || S.q.map === 2 || S.q.map === 4) return 'ukaleq';
    if (S.q.ittu === 3) return 'ukaleq';
    if (S.q.nuka >= 1) return 'nuka';
    if (S.q.pavia === 1) return 'pavia';
    if (S.q.qillaq === 1) return 'qillaq';
    if (S.q.needle >= 1 && S.q.needle <= 3) return 'ukaleq';
    return null;
}

const STORIES_DAY = [
    'Min mor sagde: en kamik er aldrig færdig, før den har gået en vinter. Den første er altid til at le af.',
    'Haren skifter pels, når dagene ændrer sig. Vi skal gøre ligeså, ellers fryser vi.',
    'Sig aldrig højt, at du er varm. Kulden hører efter.',
    'Isen taler, hvis man lytter. Den synger, før den revner.',
];
const STORIES_NIGHT = [
    'Se nordlyset, hvis det kommer. De gamle sagde, det var sjæle, der spillede bold med en hvalrosskalle. Det kommer ikke hver nat, og det er derfor, vi ser op.',
    'Du går tidligt i seng, hvis du er klog. Natten er lang herude, og den bliver længere, hvis man er træt.',
    'Bålet skal ikke dø, mens nogen sover. Det er den ældste regel, vi har.',
    'Ittu sagde altid, at stjernerne er huller i teltet. Jeg tror, han mente, at nogen deroppe har det varmt.',
];

/**
 * c = { S, has(obj), take(obj), give(obj), learn(id), giveMap(), name(item) } fra main.js.
 */
export function talk(npcId, c) {
    if (npcId === 'ukaleq') return c.S.q.map < 5 ? ukaleqMap(c) : hub(c);
    if (npcId === 'nuka') return nuka(c);
    if (npcId === 'pavia') return pavia(c);
    if (npcId === 'qillaq') return qillaq(c);
    return { lines: ['…'], options: [] };
}

const bye = { label: 'Farvel' };
const need = (c, obj) => Object.entries(obj).map(([k, v]) => `${v} ${c.name(k)}`).join(', ');

// ---- Intro: kortskindet og snedriven ----------------------------------------------------------
function ukaleqMap(c) {
    const S = c.S;
    switch (S.q.map) {
        case 0: {
            const fetch = {
                label: 'Jeg henter det',
                act: () => {
                    S.q.map = 1;
                    return {
                        lines: ['Hvalbuen ligger sydvest herfra, nede ved vandet, hvor to ribben står som en port. Kassen er gravet ned under dem. Følg pilen, du finder den.'],
                        options: [bye],
                    };
                },
            };
            return {
                lines: [
                    'Der er du. Jeg så dit bål fra igloen – du bygger det lavt, men det holder.',
                    'Ekspeditionen er draget af sted uden dig, og nu vil du efter dem, vestpå. Det kan lade sig gøre. Men ikke uden et kort, og ikke gennem passet, som det ser ud nu: en drive spærrer det helt.',
                    'Ittu, min mand, tegnede øen på et sælskind, før han gik. Det ligger i hans fangstkasse nede ved Hvalbuen. Mine knæ vil ikke så langt. Hent det til mig.',
                ],
                options: [
                    fetch,
                    {
                        label: 'Hvor er Ittu nu?',
                        act: () => ({
                            lines: [
                                'Han tog på fangst ved fuglefjeldet i efteråret. Så kom stormene. Jeg venter stadig.',
                                'Spørg ikke mere om det nu. Hent skindet, så snakker vi bagefter.',
                            ],
                            options: [fetch, bye],
                        }),
                    },
                    bye,
                ],
            };
        }

        case 1:
            return {
                lines: ['Hvalbuen, pige. Sydvest, ved vandet, hvor ribbenene står som en port. Kassen er under dem.'],
                options: [bye],
            };

        case 2:
            return {
                lines: ['Er det den? Lad mig se. Ja – hans snøre, hans knuder.'],
                options: [
                    {
                        label: 'Giv hende kortskindet',
                        act: () => {
                            S.q.map = 3;
                            c.giveMap();
                            return {
                                lines: [
                                    'Kun kysten er tegnet; resten er tomt skind. Du må selv fylde det ud, mens du går – skindet husker, hvor du har været.',
                                    'Og hvor du finder spor efter andre, så læg mærke til det: et bål, der er gået ud, en vante i sneen. Det er også en slags kort.',
                                    'Nu driven. Vinden har pakket den hård som sten, så en spade hjælper ikke. Varme gør. Byg et bål helt tæt på den, og hold det i gang – det tager et stykke tid, men driven giver efter.',
                                ],
                                options: [{ label: 'Jeg bygger et bål ved passet' }],
                            };
                        },
                    },
                    bye,
                ],
            };

        case 3:
            return {
                lines: ['Driven giver efter for varme, ikke for kræfter. Bålet skal stå helt tæt på den og brænde et godt stykke tid. Tag nok brænde med, pige.'],
                options: [bye],
            };

        default: // 4: driven er væk
            S.q.map = 5;
            return {
                lines: [
                    'Jeg så røgen fra passet, og nu er der kun vand tilbage, hvor driven var. Så er vejen åben – i hvert fald for nu.',
                    'Men du har ikke meget på kroppen, og vestpå er ingen, der låner dig en pels.',
                ],
                options: [{ label: 'Hvad foreslår du?', act: () => hub(c) }],
            };
    }
}

// ---- Samtale-hub: emner i stedet for ét trin ad gangen ----------------------------------------
function hub(c) {
    const S = c.S;
    const options = [];
    if (S.q.needle <= 3) {
        options.push({ label: S.q.needle === 0 ? 'Kan du lære mig at sy?' : 'Om syning (kamikker, anorak, lampe)', act: () => needle(c) });
    }
    if (S.q.needle >= 4 && !c.known('lantern')) options.push({ label: 'Kan man have en lampe med sig?', act: () => lanternTalk(c) });
    if (S.q.ittu === 0) options.push({ label: 'Fortæl mig om Ittus gemmer', act: () => ittuOffer(c) });
    else if (S.q.ittu <= 3) options.push({ label: 'Om Ittus gemmer', act: () => ittu(c) });
    if (S.q.ittu >= 4 && S.q.needle >= 4 && S.q.needle <= 5) options.push({ label: 'Ittus måde at sy på', act: () => ittuSewing(c) });
    options.push({ label: 'Fortæl mig en historie', act: () => story(c) }, bye);
    const first = S.q.needle === 0 && !S.metHub;
    S.metHub = true;
    return {
        lines: [first
            ? 'Din anorak er tynd, pige. Tøj er forskellen på dem, der kommer tilbage, og dem, der ikke gør. Jeg kan lære dig at sy – det tager ikke lang tid, hvis man gør det rigtigt.'
            : 'Sæt dig, pige. Hvad vil du?'],
        options,
    };
}

function story(c) {
    const S = c.S;
    const pool = S.night > 0.5 ? STORIES_NIGHT : STORIES_DAY;
    return {
        lines: [pool[(S.day + Math.floor(S.time / 40)) % pool.length]],
        options: [{ label: 'Tak', act: () => hub(c) }, bye],
    };
}

// ---- Nålen og senen ---------------------------------------------------------------------------
function needle(c) {
    const S = c.S;
    const back = { label: 'Tilbage', act: () => hub(c) };
    const thanks = { label: 'Tak', act: () => hub(c) };
    const turnIn = (cost, learnId, nextStage, lines) => {
        const ok = c.has(cost);
        return {
            lines: ok ? ['Det er nok. Giv mig det, og kig godt med.'] : [`Det kræver ${need(c, cost)}. Kom tilbage, når du har det.`],
            options: [
                {
                    label: `Giv ${need(c, cost)}`,
                    disabled: !ok,
                    act: () => {
                        c.take(cost);
                        c.learn(learnId);
                        S.q.needle = nextStage;
                        return { lines, options: [thanks] };
                    },
                },
                back,
            ],
        };
    };

    switch (S.q.needle) {
        case 0:
            return {
                lines: [
                    'Vi begynder med kamikker, for fødderne fryser først. Jeg skal bruge to skind og to sener.',
                    'Sener er det, der holder alt sammen. Haren giver én, en sæl to. Tag harpunen med ud på havisen.',
                ],
                options: [
                    { label: 'Jeg skaffer det', act: () => { S.q.needle = 1; return { lines: ['Godt. Der er sæler ved åndehullerne på havisen og harer på land. Lad dem komme til dig.'], options: [thanks] }; } },
                    back,
                ],
            };
        case 1:
            return turnIn({ hide: 2, sinew: 2 }, 'kamik', 2, [
                'Se her. Stinget går under skindet, ikke igennem – ellers drikker sømmen vand. Nu kan du selv.',
                'Og husk: slidt tøj kan lappes. Sener og et stykke skind, så er det som nyt. Åbn rygsækken, når noget er gået i stykker.',
                'Kom igen, når du vil have noget, der rigtig holder på varmen: en anorak. Den kræver tre skind, to sener og en knogle til nålen.',
            ]);
        case 2:
            return turnIn({ hide: 3, sinew: 2, bone: 1 }, 'anorak', 3, [
                'Pelsen vender indad, og sømmene skal sidde, hvor vinden kommer fra. Der. Nu er du ikke længere en gæst på isen.',
                'Der er én ting mere: en lampe af sten og spæk. Min mor lærte mig den. Den brænder, når bålet slukker. Kom med tre sten og to spæk – og hav dit eget bål tændt, så jeg ved, du kan holde det i live.',
            ]);
        default: { // 3
            const cost = { stone: 3, blubber: 2 };
            const ok = c.has(cost) && S.builtFire;
            return {
                lines: ok
                    ? ['Et bål brænder, og du har stenene. Så kan du lære den gamle lampe.']
                    : [`Til lampen skal du bruge ${need(c, cost)} – og du skal have bygget dit eget bål først.`],
                options: [
                    {
                        label: `Giv ${need(c, cost)}`,
                        disabled: !ok,
                        act: () => {
                            c.take(cost);
                            c.learn('lamp');
                            S.q.needle = 4;
                            c.give({ sinew: 2 });
                            return {
                                lines: ['En mos-tue til væge, spæk i skålen. Lad den aldrig stå tør.', 'Tag også de her to sener. Du har fortjent dem.'],
                                options: [thanks],
                            };
                        },
                    },
                    back,
                ],
            };
        }
    }
}

// ---- Rejselampen ---------------------------------------------------------------------------------------
function lanternTalk(c) {
    return {
        lines: [
            'En lampe, man bærer? Det gjorde jeg som ung, når vi gik langs kysten i mørketiden. Du tager en lille stenskål, spæk og en væge af mos – og bygger en skærm af skind omkring, så vinden ikke tager den.',
            'Den hænger ved hoften og lyser, når mørket kommer. Men den drikker spæk, ligesom alt der varmer. Og skærmen revner, hvis du er hård ved den – sener og et stykke skind, så er den hel igen.',
        ],
        options: [{ label: 'Vis mig, hvordan den laves', act: () => { c.learn('lantern'); return { lines: ['Så. To sten, to spæk, et skind og en knogle til hanken. Det er det hele.'], options: [{ label: 'Tak', act: () => hub(c) }] }; } }, { label: 'Tilbage', act: () => hub(c) }],
    };
}

// ---- Ittus gemmer: bro mellem Siku, zonerne og Ukaleqs historie ----------------------------------
function ittuOffer(c) {
    const S = c.S;
    return {
        lines: [
            'Ittu var en forsigtig mand, hvilket er sjældent blandt fangere. Han gemte sine bedste ting i jorden rundt om på øen – en økse her, brodder dér – så han aldrig stod uden, hvis stormen tog en slæde.',
            'Han skrev intet ned. Men han lærte mig, at en hund kan lugte jord, der er rørt. Siku kan finde dem.',
            'Den første gemme ligger i Tyndisen, vest for lejren, hvor isen synger om natten. Der kommer du ikke ind selv: sprækken i trykryggen er for smal til dig. Siku er tynd nok. Tryk på hunde-knappen (eller Q) for at styre hende, og grav, hvor jorden er rørt. Jeg passer dit bål imens.',
        ],
        options: [
            {
                label: 'Jeg finder dem',
                act: () => {
                    S.q.ittu = S.found.cache_axe && S.found.cache_cleats ? 3 : S.found.cache_axe ? 2 : 1;
                    return {
                        lines: ['Pas på kulden, mens du er i hundens skikkelse. Din krop står stille og fryser videre.'],
                        options: [{ label: 'Tak', act: () => hub(c) }],
                    };
                },
            },
            { label: 'Ikke nu', act: () => hub(c) },
        ],
    };
}

function ittu(c) {
    const S = c.S;
    const back = { label: 'Tilbage', act: () => hub(c) };
    if (S.q.ittu === 1) {
        return { lines: ['Tyndisen ligger vest for lejren. Sprækken i trykryggen er smal – kun Siku kommer igennem. Hun skal grave, hvor sneen er løs og rørt.'], options: [back] };
    }
    if (S.q.ittu === 2) {
        return {
            lines: [
                'Den anden gemme ligger ved Fuglefjeldet, mod nord. Der er en drive foran, som Ittu kunne løsne fra den anden side med et reb. Rebet står i Tyndisen.',
                'Hvis Siku trækker i det, åbner fjeldet sig.',
            ],
            options: [back],
        };
    }
    const knows = S.flags.ittuDead;
    return {
        lines: [knows
            ? 'Du har været oppe ved fuglefjeldet. Det står i dit ansigt, pige. Sig det, som det er.'
            : 'Du har været ved dem begge, kan jeg se på dig. Fortæl.'],
        options: [
            {
                label: 'Fortæl, hvad du fandt',
                act: () => {
                    S.q.ittu = 4;
                    c.give({ sinew: 3, hide: 1 });
                    return {
                        lines: [
                            ...(knows ? ['Jeg vidste det, da stormene holdt op og han ikke kom. Man ved det. Men det er godt at høre, at nogen sad hos ham.'] : []),
                            'En økse og et par brodder. Han huskede, at jeg altid frøs om fødderne. Så var han hjemme i hvert fald i sine tanker.',
                            'Tag det, du kan bruge. Og jeg viser dig en måde at sy på, som han lærte mig – to lag, så vinden ikke finder sømmene.',
                        ],
                        options: [{ label: 'Tak, Ukaleq', act: () => hub(c) }],
                    };
                },
            },
            back,
        ],
    };
}

function ittuSewing(c) {
    const S = c.S;
    const first = S.q.needle === 4;
    const cost = first ? { hide: 3, sinew: 2, blubber: 1 } : { hide: 5, sinew: 4, bone: 1 };
    const ok = c.has(cost);
    return {
        lines: first
            ? ['Dobbelte såler. Ittu kaldte det at gå på to vintre. Skindet vendes dobbelt, og så sys det på tværs.']
            : ['Nu pelsen. Pels ind og pels ud – så kan du stå en storm igennem. Det er det tykkeste arbejde, jeg kan.'],
        options: [
            {
                label: `Giv ${need(c, cost)}`,
                disabled: !ok,
                act: () => {
                    c.take(cost);
                    c.learn(first ? 'kamik2' : 'anorak2');
                    S.q.needle = first ? 5 : 6;
                    return { lines: [first ? 'Sådan. Nu holder de, så længe du gør.' : 'Så. Nu er du klædt til hele vinteren.'], options: [{ label: 'Tak', act: () => hub(c) }] };
                },
            },
            { label: 'Tilbage', act: () => hub(c) },
        ],
    };
}


// ---- Nuka: tålmodighed ved hullet --------------------------------------------------------------------
function nuka(c) {
    const S = c.S;
    const bye2 = { label: 'Farvel' };
    switch (S.q.nuka) {
        case 0: {
            const ask = {
                label: 'Hvad har du brug for?',
                act: () => {
                    S.q.nuka = 1;
                    return {
                        lines: ['Kød. Tre stykker, så holder min søster og børnene til næste fangst. Sæl er bedst, men en hare er ikke at kimse af. Kom med det, så sender jeg det afsted med første slæde.'],
                        options: [bye2],
                    };
                },
            };
            return {
                lines: [
                    'Bliv ved bålet. Jeg har allerede mistet en harpun i dag, og jeg vil ikke miste en gæst også.',
                    'Jeg hedder Nuka. Jeg faldt gennem isen ved Tyndisen i sidste uge, og nu kan benet ikke bære mig. Min søster og hendes børn venter på kød, og jeg kan ikke jage.',
                ],
                options: [ask, bye2],
            };
        }
        case 1: {
            const have = S.inv.meat + S.inv.cooked >= 3;
            return {
                lines: have ? ['Du har det med? Så er der mad i hytten i aften.'] : ['Tre stykker kød, ikke mindre. Sælkød er bedst – ved åndehullerne på havisen.'],
                options: [
                    {
                        label: 'Giv 3 kød',
                        disabled: !have,
                        act: () => {
                            let n = 3;
                            const useRaw = Math.min(n, S.inv.meat); S.inv.meat -= useRaw; n -= useRaw; S.inv.cooked -= n;
                            S.q.nuka = 2;
                            S.q.nukaBase = S.stats.seals;
                            c.give({ sinew: 1 });
                            if (!S.known.has('axe2')) c.learn('axe2');
                            return {
                                lines: [
                                    'Tak. Det betyder mere, end du tror. Min far lavede en økse med en knoglekant – man hugger i en isvæg på halv tid. Jeg kan ikke bruge den med benet, men jeg kan vise dig, hvordan den sættes sammen.',
                                    'Og én ting mere: du fanger sæler som en, der har travlt. Stå ved hullet og vent. Når den anden kommer op, har du lært det. Fang to, og kom tilbage.',
                                ],
                                options: [bye2],
                            };
                        },
                    },
                    bye2,
                ],
            };
        }
        case 2: {
            const done = S.stats.seals - S.q.nukaBase;
            const ok = done >= 2;
            return {
                lines: ok ? ['To sæler. Jeg kunne se på din gang, at du havde ventet.'] : [`Du har fanget ${done} af 2. Stå stille ved hullet – sælen mærker uro.`],
                options: [
                    {
                        label: 'Fortæl, hvordan det gik',
                        disabled: !ok,
                        act: () => {
                            S.q.nuka = 3;
                            c.give({ blubber: 2, sinew: 3 });
                            if (!S.known.has('harpoon2')) c.learn('harpoon2');
                            return {
                                lines: [
                                    'Så er det ikke kun hænderne, der har lært det. Her – sener og spæk fra mit bytte. Og tegningen af spidsen, min far brugte.',
                                    'Kom forbi, hvis du går forbi. Jeg er ikke svær at finde: jeg kan ikke gå nogen steder.',
                                ],
                                options: [bye2],
                            };
                        },
                    },
                    bye2,
                ],
            };
        }
        default:
            return {
                lines: [S.night > 0.5 ? 'Natten er stille. Den bedste tid at høre isen på.' : 'Gå forsigtigt ved Tyndisen. Den ser stærk ud, indtil den ikke er.'],
                options: [bye2],
            };
    }
}

// ---- Pavia: Sikus tillid --------------------------------------------------------------------------------
function pavia(c) {
    const S = c.S;
    const bye2 = { label: 'Farvel' };
    const love = Math.round(c.dogLove());
    switch (S.q.pavia) {
        case 0:
            return {
                lines: [
                    'Står hun ved dig, den grå? Kom, lad mig se hendes øjne.',
                    'Ja. Hun har Aajas øjne. Jeg havde en tæve af det navn; hun forsvandt i stormen for to år siden. Siku må være hendes sidste hvalp.',
                    'En hund følger ikke den, hun ikke stoler på – og en slæde er kun så god som hundene foran. Vind hendes tillid først. Klap hende, fodr hende, og kom tilbage, når hun ser på dig, som hun så på hende.',
                ],
                options: [{ label: 'Det skal jeg nok', act: () => { S.q.pavia = 1; return { lines: ['Tillid måles ikke i dage, men i hvem der blev, da det blev hårdt. Det ved hun allerede. Du skal bare vise det til mig.'], options: [bye2] }; } }, bye2],
            };
        case 1: {
            const ok = love >= 80;
            return {
                lines: ok ? ['Hun hviler hovedet mod dit ben. Så er det rigtigt.'] : [`Hendes tillid er ${love} %. Over 80 skal den være. Klap hende, og giv hende kød.`],
                options: [
                    {
                        label: 'Vis Pavia, at Siku stoler på dig',
                        disabled: !ok,
                        act: () => {
                            S.q.pavia = 2;
                            c.give({ sinew: 2, brand: 3 });
                            if (!S.known.has('sled2')) c.learn('sled2');
                            return {
                                lines: [
                                    'Så ved jeg, at I holder sammen. Her er, hvad jeg ved om en slæde, der skal holde: meierne af knogle, ikke træ, og bindinger af sene i stedet for læder.',
                                    'Og husk: når du styrer hende selv, ser hun ud i verden gennem dine øjne. Hun kommer steder, du ikke kan. Spørg hende – og stol på, at hun finder vej.',
                                ],
                                options: [bye2],
                            };
                        },
                    },
                    bye2,
                ],
            };
        }
        default:
            return {
                lines: [S.night > 0.5 ? 'Hundene sover tungt i nat. Det betyder godt vejr i morgen.' : 'Se på hendes ører, før du ser på himlen. De ved det først.'],
                options: [bye2],
            };
    }
}

// ---- Qillaq: fortælleren, der kendte Ittu -------------------------------------------------------------
function qillaq(c) {
    const S = c.S;
    const bye2 = { label: 'Farvel' };
    switch (S.q.qillaq) {
        case 0: {
            const tell = {
                label: 'Hvad skete der med Ittu?',
                act: () => {
                    S.flags.ittuDead = true;
                    return {
                        lines: [
                            'Han kom herop i efteråret for at fange fugle til vinteren. Så kom stormene, og han vendte ikke om hurtigt nok. Jeg fandt ham her ved fjeldet, da det var holdt op. Han havde bundet det sidste reb fast, så andre kunne komme ind fra siden.',
                            'Han var ikke bange. Det kan du sige til hende dernede, hvis du vil. Jeg kan ikke gå så langt.',
                        ],
                        options: [{ label: 'Det skal jeg sige til hende', act: () => start(), }, bye2],
                    };
                },
            };
            const start = () => {
                S.q.qillaq = 1;
                return {
                    lines: [
                        'Varderne er ikke kun vejvisere. Hver gang et hold har gået forbi, har nogen lagt en historie i dem, så de næste ved, hvem de følger. Jeg samler dem.',
                        'Find tre varder og kom tilbage og fortæl mig, hvad der stod. Så giver jeg dig skaftet til en harpun, der ikke glider i fingrene: hvaltand, ikke knogle.',
                    ],
                    options: [bye2],
                };
            };
            return {
                lines: [
                    'Så er rebet blevet trukket. Der er kun én, der kendte det knob, og han er ikke den, jeg ser foran mig. Kom nærmere, barn, vinden er skarp.',
                    'Jeg hedder Qillaq. Jeg har boet her, siden benene holdt op med at ville andre steder hen.',
                ],
                options: [tell, { label: 'Hvad laver du herude?', act: () => start() }, bye2],
            };
        }
        case 1: {
            const ok = S.cairnsFound >= 3;
            return {
                lines: ok ? ['Tre varder. Så fortæl, hvad der stod – jeg vil høre, om de gamle har skrevet, som de sagde.'] : [`Du har fundet ${S.cairnsFound} af de tre varder. Gå ud og læs. Varderne ligger, hvor ekspeditionen har rastet.`],
                options: [
                    {
                        label: 'Fortæl, hvad der stod',
                        disabled: !ok,
                        act: () => {
                            S.q.qillaq = 2;
                            c.give({ sinew: 2, blubber: 1 });
                            if (!S.known.has('harpoon3')) c.learn('harpoon3');
                            return {
                                lines: [
                                    'Ja. Det lyder som dem. Hvem der skriver, glemmer, at andre skal læse – og husker det først, når de er væk.',
                                    'Tag skaftet. Og lyt: nordlyset kommer ikke hver nat. De gamle sagde, at det kun viser sig for den, der har gjort sit. Så hvis du ikke ser det, har du ikke fejlet. Det er bare ikke nat endnu.',
                                ],
                                options: [bye2],
                            };
                        },
                    },
                    bye2,
                ],
            };
        }
        default:
            return {
                lines: [S.night > 0.5 && S.auroraNight ? 'Se. Nu viser det sig. Det gør det aldrig for dem, der skynder sig.' : 'Jeg sidder her og venter på den næste, der kommer forbi med en historie.'],
                options: [bye2],
            };
    }
}

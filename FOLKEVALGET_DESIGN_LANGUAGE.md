# Folkevalget.dk - Designsprog og mission

> Dette dokument er fundamentet for alle beslutninger om Folkevalget.dk.
> Naar der er tvivl om en feature, en formulering eller et design-valg,
> gaa tilbage hertil.

---

## 1. Hvad er Folkevalget?

Folkevalget er et uafhaengigt analysevaerktoj der goer Folketingets
officielle data tilgaengelig for alle. Siden samler stemmedata,
udvalgsarbejde, fremmoedestatistik og baggrundsinformation i et format
der inviterer til at udforske, sammenligne og forstaa.

Folkevalget er ikke en nyhedsside. Folkevalget er ikke et meningsmedie.
Folkevalget er et vaerktoj der viser hvad der er sket, og lader
brugeren drage sine egne konklusioner.


## 2. Hvorfor eksisterer Folkevalget?

### Problemet

Valgkamp fortaeller meget om budskaber og meget lidt om adfaerd. Naar en
politiker stiller sig op paa en plakat med tre ord, har vaelgeren ingen
praktisk maade at tjekke om de tre ord passer med fire aars arbejde i
Folketinget. Den information eksisterer allerede: Folketinget
offentliggoer alt. Men det er begravet i OData-protokoller, XML-filer og
PDF-dokumenter som ingen normal borger aabner.

### Vores lossning

Vi henter de offentlige data, beregner noegletal og praesenterer dem i
et format der kan laeses uden teknisk baggrund. Hver profil, hver
afstemning og hvert tal linker tilbage til den officielle kilde, saa alt
kan verificeres.

### Maalbar succes

Folkevalget lykkes hvis en bruger kan:

1. Finde en politiker paa under 10 sekunder
2. Forstaa de vigtigste noegletal uden forklaring
3. Sammenligne to politikere paa under 30 sekunder
4. Finde den officielle kilde bag ethvert tal med et enkelt klik
5. Laere noget om Folketingets arbejde de ikke vidste foer


## 3. Hvem er Folkevalget til?

### Primaer bruger: Den nysgerrige borger

Alder er ligegyldigt. Det afgoerende er en bestemt type nysgerrighed: folk
der hellere vil se tal end hoere argumenter. Folk der stoler mere paa hvad
nogen goer end hvad de siger.

De er ikke noedvendigvis politisk aktive. De ved maaske ikke hvad en
ordfoerertale er, eller hvad et paragraf 20-spoergsmaal betyder. Det er
helt fint. De vil vide: moeder hun op? Stemmer han med sit parti? Hvad
har de stemt om? Hvem sidder i min storkreds?

Disse brugere har ikke tid til at laere et nyt system. Hvis noget er
uklart, forlader de siden. Hvert element paa siden skal enten vaere
selvforklarende eller have en kort inline-forklaring.

### Sekundaer bruger: Den professionelle

Journalister, politiske raadgivere, forskere, studerende. De vil grave
dybere. De vil filtrere, sortere og krydstjekke. De ved hvad en
betaenkning er, og de vil have link til den.

Disse brugere har taaalmodighed til at laere sidens funktioner, men de
har ikke tid til at vente paa at data loader eller klikke igennem ti
sider for at faa et svar.

### Designprincip

Byg overfladen til den nysgerrige borger. Byg dybden til den
professionelle. Samme data, to lag.


## 4. Folkevalgets vaerdier

### 4.1 Neutralitet

Folkevalget tager ikke stilling. Ingen farve, formulering eller
placering maa signalere at et parti eller en politiker er bedre eller
daarligere end en anden. Partifarverne bruges kun til identifikation,
aldrig til vaerdilaegning.

Naar vi viser et fremmoedeetal paa 12 procent, viser vi ikke et rodt
advarselstegn. Vi viser tallet og forklarer hvad det betyder. Hvis
personen er minister, forklarer vi at ministre sjaldent stemmer i salen.
Brugeren beslutter selv om 12 procent er acceptabelt.

Vi skriver aldrig "kun 12 procent" eller "hele 98 procent". Vi skriver
"12 procent" og "98 procent".

Sortering er aldrig vaerdiladet som default. Default er altid alfabetisk
eller kronologisk. Brugeren vaelger selv at sortere efter fremmoeede
eller loyalitet.

### 4.2 Gennemsigtighed

Ethvert tal paa siden skal kunne spores tilbage til en kilde. Hvert
noegletal har en klar definition der er synlig for brugeren. Hvert
datapunkt linker til ft.dk, oda.ft.dk, retsinformation.dk eller den
relevante officielle kilde.

Vi skjuler aldrig vores metode. Hvis vi beregner partiloyalitet paa en
bestemt maade, dokumenterer vi formlen. Hvis data mangler, siger vi det.
Hvis et tal kan mislaeses, forklarer vi det.

### 4.3 Tilgaengelighed

Ingen bruger skal foeele sig dum. Hvert fagudtryk der ikke er
almenkendt faar en kort forklaring foerste gang det optrsder. Vi
bruger konsekvent den enkleste formulering der stadig er praecis.

Eksempler:

- "Ordfoerer" -> forklares foerste gang som "den politiker der taler
  paa partiets vegne i en given sag"
- "Betaenkning" -> "udvalgets skriftlige vurdering af et forslag"
- "Paragraf 20-spoergsmaal" -> "skriftligt spoergsmaal fra et
  folketingsmedlem til en minister"

Forklaringer vises som korte inline-tekster eller tooltips, aldrig som
pop-ups eller separate sider.

### 4.4 Praecision

Vi runder ikke tal for at goere dem paenere. Hvis fremmoeedet er 56,4
procent, skriver vi 56,4 procent, ikke "ca. 57 procent". Tal er vores
produkt. De skal vaere korrekte.

Naar data har forbehold, naevner vi forbeholdet. "Fremmoeede beregnes paa
baggrund af afstemninger i salen. Udvalgsarbejde, ministeropgaver og
andre parlamentariske aktiviteter indgaar ikke."

### 4.5 Respekt

Politikere er mennesker der har valgt at stille sig til raadighed for
offentligheden. Folkevalget behandler dem med samme respekt som enhver
anden person. Vi viser fakta, aldrig haanlige formuleringer, sarkasme
eller kontekstloese sammenligninger designet til at faa nogen til at se
daarlige ud.

Hvis en dataprsentation risikerer at vaere misvisende, er det vores
ansvar at tilfoeje kontekst, ikke brugerens ansvar at finde den.


## 5. Designsprog

### 5.1 Tone of voice

Folkevalgets tone er rolig, klar og direkte. Vi skriver som en
velinformeret ven der forklarer noget over en kop kaffe: ingen jargon,
ingen nedladenhed, ingen dramatik.

**Ja:**
- "Mette Frederiksen har stemt i 74 procent af afstemningerne."
- "Fremmoeede viser hvor ofte et medlem har afgivet stemme i salen."
- "Denne afstemning blev vedtaget med 98 stemmer for og 72 imod."

**Nej:**
- "Mette Frederiksen pjaekkede fra hver fjerde afstemning!"
- "Chokerende lavt fremmoeede afsloeerer..."
- "Endnu en gang stemte de imod folkets interesse..."

### 5.2 Visuelt sprog

**Typografi:** Redaktionelt og laesbart. Stserke overskrifter i serif
der signalerer autoritetet. Brodtekst i sans-serif der er nem at scanne.
Kontrasten mellem de to skaber visuelt hierarki uden at raabe.

**Farver:** Neutral base med varmt hvidt og moerkt graat. Partifarver
bruges til identifikation, aldrig dekorativt. Datafarverne (for, imod,
fravaer) er konsistente paa tvaers af hele sitet og bruger toner der er
laesbare for farveblinde.

Folkevalgets eget brand bruger moerke blaa som accent. Det er en
institutionel farve der ikke tilhoerer noget parti.

**Rum og luft:** Generoes whitespace. Data skal have plads til at
aande. Taette dashboards faar brugere til at foeele sig overvaeldede.
Folkevalget er ikke et cockpit, det er et bibliotek.

**Kort og diagrammer:** Bruges kun naar de kommunikerer hurtigere end
tekst. En fordeling af for/imod/fravaer er lettere at laese som en bar
end som tre tal. En partihistorik er lettere at laese som en tidslinje
end som en liste. Men en politicians uddannelse er lettere at laese som
tekst end som et ikon.

### 5.3 Informationsarkitektur

**Princip: Overblik foerst, detalje bagefter.**

Hver side starter med det vigtigste, synligt uden at scrolle. Detaljer
ligger nedenunder, organiseret i klare sektioner. Brugeren skal aldrig
gaette hvad naeste skridt er.

**Navigation:**

Siten har tre primaere indgange:

1. **Profiler** - find en politiker, se deres data
2. **Afstemninger** - find en afstemning, se hvem der stemte hvad
3. **Folketinget** - forstaa hvordan det hele haenger sammen

Disse tre er altid synlige. Alt andet er sekundaert.

**Progressive disclosure:**

Lag 1 (alle ser): Noegletal, partitilhoersforhold, seneste afstemninger.
Lag 2 (nysgerrige klikker): Udvalg, partihistorik, uddannelse, emneomraader.
Lag 3 (professionelle graver): Fulde stemmelister, krydstjek med kilder, raa data.

### 5.4 Interaktionsmoenstre

**Soegning:** Altid tilgaengelig. Soeg paa politikernavn, parti,
storkreds, afstemningsemne eller lovforslagsnummer. Et felt, alle typer.

**Filtrering:** Paa desktop er filtre altid synlige, ikke gemt bag en
knap. Paa mobil (under 640px) collapses filtre bag en "Filtrer"-knap
fordi skaermpladsen kraever det, men aktive filtre vises ALTID som
synlige chips over resultaterne, uanset platform. At fjerne et filter
er lige saa let som at tilfoeje det.

**Sortering:** Default er altid neutral (alfabetisk/kronologisk).
Brugeren vaelger selv. Det aktive sorteringskriterium er altid synligt.

**Links:** Alt der kan vaere en kilde er et link. Politikernavne linker
til profiler. Afstemningsnumre linker til afstemningsdetaljer. Udvalg
linker til ft.dk. Intet er en blindgyde.

**Tomme tilstande:** Naar data mangler, vis aldrig en tom side eller
en fejlmeddelelse. Vis hvad der er, og forklar kort hvorfor resten
mangler: "Ingen registrerede afstemninger i datasaettet" eller
"Biografi ikke tilgaengelig fra Folketingets data."


## 6. Ordliste

Folkevalget bruger konsekvent disse formuleringer. Naar Folketingets
eget sprog er uklart, oversaetter vi til dagligsprog i brugerfladen
og forklarer fagtermen i en tooltip.

| Folketingets term | Folkevalgets visning | Tooltip-forklaring |
|-------------------|---------------------|--------------------|
| Afstemning | Afstemning | En formel votering i Folketingssalen |
| Vedtaget/forkastet | Vedtaget/forkastet | Resultatet af afstemningen |
| Lovforslag (L) | Lovforslag | Et forslag til en ny lov eller en aendring af en eksisterende |
| Beslutningsforslag (B) | Beslutningsforslag | Et forslag der paalaegger regeringen at handle, men som ikke er en lov |
| Foresporgsel (F) | Foresporgsel | En debat i salen indledt af et eller flere medlemmer, rettet til en minister |
| Forslag til vedtagelse (V) | Vedtagelsesforslag | Et kort forslag der udtrykker Folketingets holdning til et emne |
| Ordfoerer | Ordfoerer | Den politiker der taler paa partiets vegne i en given sag |
| Betaenkning | Betaenkning | Udvalgets skriftlige vurdering af et forslag foer 2. behandling |
| Paragraf 20-spoergsmaal | Spoergsmaal til minister | Et skriftligt spoergsmaal fra et folketingsmedlem til en minister, som ministeren skal besvare inden 6 dage |
| Samraadsspoergsmaal | Samraad | En mundtlig udsprgsning af en minister i et udvalg |
| Sagstrin | Behandlingstrin | De enkelte trin et forslag gennemgaar (1. behandling, udvalg, 2. behandling, 3. behandling) |
| Partiloyalitet | Partiloyalitet | Andelen af afstemninger hvor medlemmet stemte som flertallet i eget parti |
| Fremmoeede | Fremmoeede | Andelen af afstemninger hvor medlemmet afgav stemme i stedet for at vaere fravaerende |
| Storkreds | Storkreds | Det geografiske omraade en politiker er valgt i. Danmark er inddelt i 10 storkredse |
| Hvervregister | Oekonomiske interesser | Folketingets register over medlemmernes bestyrelsesposter, bijobs og investeringer |


## 7. Sidens struktur

### 7.1 Forside (index.html)

Formaal: Forklar hvad Folkevalget er og send brugeren videre.
Skal besvare: "Hvad er det her?" og "Hvor starter jeg?"

Indhold:
- Overskrift og tagline (maks to saetninger)
- Tre noegletal (antal profiler, antal afstemninger, seneste opdatering)
- To primaere indgange: "Udforsk profiler" og "Udforsk afstemninger"
- Kort "Saadan virker det" sektion (tre trin, maks 20 ord per trin)

Forsiden skal ikke forklare alt. Den skal skabe nok tillid og
nysgerrighed til at brugeren klikker videre.

### 7.2 Opdag profiler (discover.html)

Formaal: Find, filtrer og sammenlign politikere.
Skal besvare: "Hvem sidder i Folketinget?" og "Hvem repraesenterer mig?"

Indhold:
- Soegefelt (autofocus)
- Filtre: parti, storkreds, udvalg
- Sortering: navn, fremmoeede, loyalitet
- Profilkort med: navn, foto, parti, storkreds, noegletal
- Klik paa kort -> profilside

### 7.3 Profilside (profil.html)

Formaal: Forstaa en enkelt politiker i dybden.
Skal besvare: "Hvad goer denne person i Folketinget?"

Lag 1 (synligt uden scroll):
- Navn, foto, parti, storkreds, profession
- Minister/ny-tag hvis relevant
- Tre noegletal: fremmoeede, loyalitet, antal stemmer

Lag 2 (scroll ned):
- Seneste afstemninger med titel, dato, stemme
- Aktive udvalg med links til ft.dk

Lag 3 (yderligere sektioner):
- Uddannelse og beskaftigelse (naar tilgaengeligt)
- Partihistorik (naar relevant)
- Link til ft.dk profil
- Link til hvervregister (naar implementeret)

### 7.4 Afstemningsbrowser (afstemninger.html)

Formaal: Udforsk afstemninger paa tvaers af politikere og partier.
Skal besvare: "Hvad er der blevet stemt om?" og "Hvem stemte hvad?"

Indhold:
- Kronologisk liste over afstemninger
- Filtre: emneomraade, resultat (vedtaget/forkastet), dato
- Hver afstemning viser: nummer, titel, dato, resultat, partifordeling
- Klik -> detaljeside med alle individuelle stemmer

### 7.5 Folketinget (folketinget.html)

Formaal: Giv kontekst og baggrundsviden.
Skal besvare: "Hvordan virker Folketinget?" og "Hvad betyder tallene?"

Indhold:
- Visuel guide til lovgivningsprocessen
- Forklaring af noegletal (fremmoeede, loyalitet)
- Forklaring af ministerrollen og fremmoeede
- Ordliste med parlamentariske begreber
- Links til officielle kilder

### 7.6 Om (om.html)

Formaal: Skab tillid og gennemsigtighed om siden selv.
Skal besvare: "Hvem staar bag?" og "Kan jeg stole paa det?"

Indhold:
- Hvem laver Folkevalget (navn, baggrund, motivation)
- Datakilder og metode
- Opdateringsfrekvens
- Kontaktinformation
- Kildekode (link til GitHub)


## 8. Regler for praesentation af data

### 8.1 Tal

- Vis altid praecise tal. Ikke "ca." eller "omkring".
- Brug dansk talformat: 56,4 procent, 1.569 afstemninger.
- Vis procenttegn som tekst ("56,4 %"), ikke som farvekodet grafik.
- Afrund kun naar praecisionen er meningslos (fx "valgt i 1994", ikke
  "valgt den 21. september 1994" paa et oversigtskort).

### 8.2 Farver i data

- For-stemme: groen (tilgaengelig tone, ikke neon)
- Imod-stemme: roed (tilgaengelig tone)
- Fravaer: neutral graa eller gul
- Partifarver: kun til identifikation, aldrig til vaerdilaegning
- Aldrig brug roed/groen til at indikere "godt/daarligt"

### 8.3 Tomme felter

- Manglende biografi: skjul sektionen
- Manglende uddannelse: skjul sektionen
- Nul afstemninger: vis "Ingen registrerede afstemninger i datasaettet"
  med kort forklaring (fx "Nyvalgt medlem" eller "Faeroesk mandat")
- Manglende hvervregister: vis "Ikke registreret i Folketingets
  hvervregister" (det er i sig selv information)

### 8.4 Kontekstualisering

Hvert noegletal der kan misforstaaes faar en kort kontekst:

- Fremmoeede under 20 %: vis note "Ministre deltager sjaldent i
  afstemninger, da de varetager ministerarbejde"
- Partiloyalitet paa 100 %: vis note "Beregnet paa baggrund af
  afstemninger hvor mindst to partimedlemmer deltog"
- Fremmoeede paa 0 %: vis note med mulig forklaring (nyt medlem,
  faeroesk/groenlandsk mandat, minister)

Kontekst vises som en lille tekst under tallet, ikke som et pop-up.


## 9. Hvad Folkevalget IKKE er

- Folkevalget er ikke en valgguide. Vi anbefaler ikke hvem man skal
  stemme paa.
- Folkevalget er ikke et meningsmedie. Vi tager ikke stilling til
  politiske spoergsmaal.
- Folkevalget er ikke en AI-tjeneste. Vi bruger ikke AI til at
  opsummere, vurdere eller anbefale.
- Folkevalget er ikke en social platform. Der er ingen kommentarer,
  ingen likes, ingen delinger.
- Folkevalget er ikke en kampagneside. Vi saelger ikke annoncer og
  promoverer ikke partier.
- Folkevalget er ikke perfekt. Data kan have fejl. Vi dokumenterer
  vores metode og opfordrer brugere til at tjekke kilden.


## 10. Designbeslutninger der allerede er taget

| Beslutning | Begrundelse |
|-----------|-------------|
| Statisk site (GitHub Pages) | Ingen server, ingen driftsomkostninger, hurtig |
| Data pre-fetched som JSON | Brugere belaster ikke Folketingets API |
| Ingen brugerkonti | Unoedvendig kompleksitet |
| Ingen AI-opsummeringer | For let at anklage for bias |
| Ingen reklamer | Trovaerdighed er alt |
| Dansk sprog | Maalgruppen er danske vaelgere |
| Open source | Gennemsigtighed om kode og metode |
| ft.dk som primaer kilde | Officielle data, verificerbare |


## 11. Sporgsmaal vi stiller foer hver ny feature

1. Goer den det lettere at forstaa hvad en politiker goer?
2. Kan den misbruges til at vildlede?
3. Er datakilden officiel og verificerbar?
4. Kan en ikke-teknisk bruger forstaa den uden forklaring?
5. Tilfojer den reel vaerdi, eller er den bare "nice to have"?

Hvis svaret paa 1, 3 og 4 er ja, og svaret paa 2 er haandterbart,
bygger vi den.


## 12. Visuelle konstanter

Disse vaerdier bruges i al CSS. De er ikke forslag, de er regler.

### 12.1 Farvepalette

```
/* Base */
--color-bg:            #FAFAF7;    /* varm hvid, hovedbaggrund */
--color-surface:       #FFFFFF;    /* kort, sektioner */
--color-text:          #1A1A1A;    /* brodtekst */
--color-text-secondary:#5A5A5A;    /* labels, metadata */
--color-border:        #E5E5E0;    /* skillelinjer, kortkanter */

/* Brand */
--color-accent:        #1B4D6E;    /* links, aktive elementer, logo */
--color-accent-hover:  #153D58;    /* hover-tilstand */

/* Stemmefarver */
--color-for:           #2E7D32;    /* for-stemme */
--color-imod:          #C62828;    /* imod-stemme */
--color-fravaer:       #9E9E9E;    /* fravaer */

/* Partifarverne defineres i en separat variabelliste og bruges KUN
   til partibadges og identifikationsfarver, aldrig som baggrund
   eller dekoration. */
```

### 12.2 Typografi

```
/* Overskrifter */
--font-heading:        "Source Serif 4", "Georgia", serif;

/* Brodtekst, labels, UI */
--font-body:           "DM Sans", "Helvetica Neue", sans-serif;

/* Tal og data */
--font-data:           "DM Sans", sans-serif;
  /* Tal vises altid i tabular-nums for alignment:
     font-variant-numeric: tabular-nums; */

/* Stoorrelser */
--text-xs:   0.75rem;    /* 12px - metadata, tooltips */
--text-sm:   0.875rem;   /* 14px - labels, sekundaer tekst */
--text-base: 1rem;       /* 16px - brodtekst */
--text-lg:   1.125rem;   /* 18px - lead-tekst */
--text-xl:   1.5rem;     /* 24px - sektionsoverskrifter */
--text-2xl:  2rem;       /* 32px - sideoverskrifter */
--text-3xl:  2.75rem;    /* 44px - hero-overskrift, kun forside */
```

### 12.3 Spacing

```
--space-xs:   0.25rem;   /*  4px */
--space-sm:   0.5rem;    /*  8px */
--space-md:   1rem;      /* 16px */
--space-lg:   1.5rem;    /* 24px */
--space-xl:   2rem;      /* 32px */
--space-2xl:  3rem;      /* 48px */
--space-3xl:  4rem;      /* 64px */

/* Sektioner adskilles med space-2xl eller space-3xl.
   Elementer inden i en sektion adskilles med space-md eller space-lg.
   Aldrig mere end to niveauer af spacing inden for samme sektion. */
```

### 12.4 Overgang og animation

```
--transition-fast:     150ms ease;
--transition-default:  250ms ease;

/* Animationer bruges SPARSOMT. Tilladte use cases:
   - Fade-in ved sideload (opacity 0 -> 1, staggered)
   - Hover-tilstande paa kort og links
   - Filter/sortering resultater (layout-shift)

   Forbudte use cases:
   - Dekorative animationer der ikke kommunikerer tilstandsaendring
   - Parallax eller scroll-triggerede effekter
   - Bounce, wiggle eller anden "legestojs"-animation */
```


## 13. Komponentregler

### 13.1 Formsprog

Folkevalgets formsprog er skarpt og plant. Ingen runde hjorner der
signalerer "venlig app". Ingen skygger der simulerer dybde.

```
/* Hjorner */
border-radius: 2px;         /* standard for alle elementer */
                             /* ALDRIG pills, ALDRIG fuldt runde hjorner */
                             /* Eneste undtagelse: profilfotos (50%, cirkel) */

/* Skygger */
box-shadow: none;            /* udgangspunkt for alle elementer */
                             /* Skygger bruges KUN paa sticky header ved scroll */

/* Kanter */
border: 1px solid var(--color-border);  /* standard for kort og sektioner */
                                         /* Venstrekant i partifarve paa kort: 3px solid */
```

### 13.2 Kort (profilkort, afstemningskort)

Et kort er en afgraenset beholder med data. Det er ikke en knap,
ikke en widget, ikke en "tile".

Regler:
- Baggrund: var(--color-surface)
- Kant: 1px solid var(--color-border)
- Padding: var(--space-lg)
- Maks indhold per kort: navn, et foto, tre til fem datapunkter, en handling
- Kort har ALDRIG skygge i default-tilstand
- Hover: border-color moerkner eet trin, cursor: pointer
- Hele kortet er klikbart. Implementeres som card-link-moenster:
  kortet indeholder et enkelt `<a>` element (typisk paa navnet) med
  `::after { content: ""; position: absolute; inset: 0; }` der
  udstrækker klikfladen til hele kortet. Andre interaktive elementer
  (fx et eksternt link til ft.dk) placeres med `position: relative;
  z-index: 1;` saa de forbliver uafhaengigt klikbare. Der maa ALDRIG
  vaere et `<a>` eller `<button>` wrappet omkring hele kortet, da det
  skaber nested interactive elements og oedelaegger skaermlaeser-oplevelsen.

Begransninger:
- Maks to kort i bredden paa desktop
- Et kort i bredden paa mobil
- Aldrig mere end 20 kort synlige foer pagination/infinite scroll
- Hvis indhold er for langt til kortet, afkort IKKE med "..." men
  reducer maaengden af data der vises paa kortet

### 13.3 Badges og tags

Badges bruges til kategorisering. De er smaa, diskrete og informative.

```
/* Badge (parti, minister, ny) */
display: inline-block;
padding: 2px 8px;
font-size: var(--text-xs);
font-weight: 600;
text-transform: uppercase;
letter-spacing: 0.05em;
border: 1px solid;
border-radius: 2px;
background: transparent;        /* ALDRIG filled badges */
```

Regler:
- Maks tre badges per element (fx "S" + "Minister" + "Ny")
- Partibadge bruger partifarve som border og tekst
- Minister-badge bruger var(--color-accent)
- "Ny"-badge bruger var(--color-text-secondary)
- Badges staar ALTID foer navnet, aldrig efter
- Badges bruges ALDRIG til tal (brug noegletal-komponenten i stedet)

### 13.4 Noegletal

Et noegletal er et fremhaeved tal med en label. Det er sidens vigtigste
visuelt element.

```
/* Noegletal */
.key-stat {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.key-stat__label {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}
.key-stat__value {
  font-size: var(--text-xl);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}
```

Regler:
- Maks fem noegletal paa en profilside oeeverst
- Maks tre noegletal paa et kort
- Noegletal staar aldrig alene uden label
- Label er altid OVER tallet, aldrig ved siden af
- Tal bruger aldrig farve til at indikere "godt/daarligt",
  undtagen stemmefarver (for/imod/fravaer) i stemmespecifikke kontekster

### 13.5 Knapper

Folkevalget har to typer knapper. Ikke flere.

```
/* Primaer: handling der sender brugeren videre */
.btn-primary {
  display: inline-block;
  padding: 10px 20px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-bg);
  background: var(--color-accent);
  border: 2px solid var(--color-accent);
  border-radius: 2px;
  cursor: pointer;
  transition: background var(--transition-fast);
}
.btn-primary:hover {
  background: var(--color-accent-hover);
}

/* Sekundaer: alternativ handling, links til eksterne kilder */
.btn-secondary {
  display: inline-block;
  padding: 10px 20px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-accent);
  background: transparent;
  border: 2px solid var(--color-accent);
  border-radius: 2px;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.btn-secondary:hover {
  background: var(--color-accent);
  color: var(--color-bg);
}
```

Regler:
- Maks en primaer knap per synligt viewport
- Sekundaere knapper bruges til "Aabn paa ft.dk", "Se alle" og lignende
- Knapper har aldrig ikoner
- Knaptekst er altid en handling: "Gaa til profiler", ikke "Profiler"
- Ingen ghost buttons, ingen tekst-links stylet som knapper

### 13.6 Tabeller og lister

Data i tabeller naar der er tre eller flere kolonner. Data i lister
naar der er to kolonner eller faerre.

```
/* Tabel */
width: 100%;
border-collapse: collapse;

/* Tabel-header */
text-align: left;
font-size: var(--text-xs);
font-weight: 600;
text-transform: uppercase;
letter-spacing: 0.05em;
color: var(--color-text-secondary);
padding: var(--space-sm) var(--space-md);
border-bottom: 2px solid var(--color-text);

/* Tabel-raekke */
padding: var(--space-sm) var(--space-md);
border-bottom: 1px solid var(--color-border);
```

Regler:
- Aldrig zebra-striber (de tilfojer visuel stoej)
- Hover-highlight paa raekker: background med 4% opacity af accent
- Tal hoejrestilles altid i tabeller
- Tekst venstrestilles altid
- Tabeller er aldrig bredere end indholdsomraadet
- Paa mobil: tabeller med mere end tre kolonner konverteres til
  stablede kort

### 13.7 Sektioner

En sektion er en afgraenset del af en side med en overskrift.

Regler:
- Sektionsoverskrift: uppercase label i var(--text-xs) med
  var(--color-accent), efterfulgt af en beskrivende overskrift i
  var(--text-xl)
- Sektioner adskilles med var(--space-2xl) eller var(--space-3xl)
- En sektion vises hvis den har data. Ellers skjules den HELT.
  Ingen tomme sektioner, ingen "ingen data"-placeholders, ingen
  collapsed/accordion-tilstande.
- Undtagelse: felter der BURDE vaere udfyldt (fx hvervregisteret)
  vises med en kort forklaring ("Ikke registreret").

### 13.8 Mobilprioriteter

Mobil er ikke en skaleret version af desktop. Det er en separat
prioritering af indhold.

Regler:
- Foerste synlige element: soegefelt eller vigtigste noegletal
- Navigation: burger-menu, aldrig vandret scroll
- Kort: et per raekke, aldrig to
- Noegletal: stablet vertikalt, aldrig i vandret grid
- Filtre: collapsed bag en "Filtrer"-knap, vises som overlay
- Tabeller: konverteres til kort paa skserme under 640px
- Tekststoerrelse: minimum 16px for brodtekst (forhindrer iOS zoom)
- Touch targets: minimum 44x44px

### 13.9 Naar skjule vs. collaps vs. opsummere

| Situation | Handling |
|-----------|---------|
| Data eksisterer ikke (fx ingen biografi) | Skjul sektionen helt |
| Data eksisterer men er tom (fx hvervregister uden poster) | Vis sektion med forklaring |
| Data eksisterer og er lang (fx 50 afstemninger) | Vis de foerste 10, "Vis alle" knap |
| Data er sekundaer (fx partihistorik for folk der aldrig har skiftet) | Skjul sektionen |
| Data er kontekst (fx ministerforklaring) | Vis som inline-note under det relevante tal |

Aldrig brug accordion/collapse som default. Brugere overser indhold
der er gemt. Vis det eller fjern det.

# Folkevalget.dk - Udtommende datainventar

> Alle offentligt tilgaengelige data om folketingsmedlemmer, sorteret efter kilde, med vurdering af relevans, tilgaengelighed og prioritet for Folkevalget.dk.
>
> Sidst opdateret: 28. februar 2026

---

## KILDE 1: Folketingets Aabne Data (ODA API)

**Adgang:** REST API via `https://oda.ft.dk/api/`
**Format:** JSON / XML (OData-protokol)
**Autentificering:** Ingen (frit tilgaengeligt)
**Begransning:** Max 100 resultater per request, brug `$skip` til paginering
**Licens:** Fri brug med kildeangivelse (ft.dk)
**Opdateringsfrekvens:** Dagligt (natkopi kl. 02:00)
**Database-backup:** Fuld SQL Server backup tilgaengelig via FTP (ftp://oda.ft.dk)

### 1.1 Aktoer (politiker-stamdata)

**Endpoint:** `/api/Aktoer?$filter=typeid eq 5` (typeid 5 = folketingsmedlemmer)

| Felt | Beskrivelse | Relevant? | Vis paa side? |
|------|-------------|-----------|---------------|
| id | Unikt ID i ODA | Ja (noegel) | Nej (intern) |
| navn | Fulde navn | Ja | Ja - profilkort + profilside |
| fornavn | Fornavn | Ja | Evt. soegning |
| efternavn | Efternavn | Ja | Evt. sortering |
| biession | Beskaftigelse/profession | Ja | Ja - under navn paa profilkort |
| typeid | Aktoertype (5=MF) | Ja (filter) | Nej (intern) |
| gruppenavnkort | Partiforkortelse (S, V, SF...) | Ja | Ja - partibadge |
| startdato | Foerste gang i Folketinget | Ja | Ja - anciennitet |
| slutdato | Udtraadt (null = aktiv) | Ja | Ja - filter aktive/tidligere |
| opdateringsdato | Seneste opdatering | Ja | Nej (intern) |
| periodeid | Valgperiode | Ja | Evt. historik |

**Biografi-felt (XML-format i Aktoer):**

Feltet `biografi` indeholder et helt CV i XML-format. Det er den SAMME tekst der vises paa ft.dk/medlemmer. Parse dette for:

| Data i biografi | Eksempel | Relevant? | Vis paa side? | Haandtering af tomme felter |
|-----------------|----------|-----------|---------------|-----------------------------|
| Foedselsdato og -sted | "foedt 15. maj 1964 i Vejle" | Ja | Ja - alder | Skjul sektionen |
| Foraeldre | "soen af regnskabschef Jeppe..." | Nej | Nej - irrelevant | - |
| Uddannelse | "Cand.jur., Koebenhavns Universitet, 1992" | Ja | Ja - kort format | Skjul sektionen |
| Beskaftigelse foer politik | "Selvstaendig konsulentvirksomhed, 1990-1995" | Ja | Ja - kort format | Skjul sektionen |
| Medlemsperioder | "Folketingsmedlem for Venstre i Sjaellands Storkreds fra 19. maj 2022" | Ja | Ja - partihistorik tidslinje | Vis kun nuvaerende parti |
| Kandidatopstillinger | "Kandidat for Moderaterne i alle opstillingskredse i Sjaellands Storkreds" | Ja | Ja - storkreds | Skjul |
| Ministerposter | "Udenrigsminister fra 15. december 2022" | Ja | Ja - minister-tag + forklaring af lavt fremmoede | Intet tag (normalt) |
| Tidligere ministerposter | "Statsminister, 28. juni 2015 - 27. juni 2019" | Ja | Ja - tidslinje | Skjul |
| Parlamentarisk karriere | "Politisk leder for Moderaterne fra 2022" | Ja | Ja - rolle-tag | Skjul |
| Tillidshverv | "Formand for bestyrelsen for LoekkeFonden" | Delvist | Evt. udvalgte | Skjul |
| Publikationer | "Forfatter til 'Ud af det blaa'" | Nej | Nej - irrelevant for transparens | - |

**VIGTIGT om unge/nye MF'ere:** Biografi-feltet kan vaere meget kort eller naesten tomt for nye medlemmer. Designprincip: vis kun hvad der er, skjul resten. En profil med kun "Navn + Parti + Storkreds + Stemmer" er stadig nyttig.

### 1.2 Aktoer-Aktoer relationer

**Endpoint:** `/api/AktoerAktoer`

Forbinder aktoerer til hinanden. Bruges til at finde:

| Relation (rolleid) | Fra -> Til | Relevant? | Vis paa side? |
|---------------------|-----------|-----------|---------------|
| Medlem af parti | MF -> Parti | Ja | Ja - partitilhoersforhold |
| Medlem af udvalg | MF -> Udvalg | Ja | Ja - udvalgsliste (allerede implementeret) |
| Valgt i storkreds | MF -> Storkreds | Ja | Ja - storkredsfilter |
| Ordforer/formand | MF -> Udvalg (med rolle) | Ja | Ja - rolle i udvalg |
| Stedfortraeder for | MF -> MF | Delvist | Evt. note |

Alle relationer har `startdato` og `slutdato`, saa partihistorik kan rekonstrueres.

### 1.3 Afstemninger

**Endpoint:** `/api/Afstemning`

| Felt | Beskrivelse | Relevant? | Vis paa side? |
|------|-------------|-----------|---------------|
| id | Unikt afstemnings-ID | Ja (noegel) | Nej |
| nummer | Afstemningsnummer i samling | Ja | Ja - "V 29", "L 92" |
| konklusion | "Forslaget blev vedtaget" / "forkastet" | Ja | Ja - resultat |
| vedtaget | Boolean | Ja | Ja - farveindikator |
| typeid | Type afstemning | Ja | Evt. filter |
| sagid | Kobling til sag/lovforslag | Ja | Ja - link til sagstitel |
| dato | Dato for afstemning | Ja | Ja - sortering og visning |

### 1.4 Stemmer (individuelle stemmer)

**Endpoint:** `/api/Stemme`

| Felt | Beskrivelse | Relevant? | Vis paa side? |
|------|-------------|-----------|---------------|
| aktoer_id | Hvem stemte | Ja (kobling) | Nej |
| afstemning_id | Hvilken afstemning | Ja (kobling) | Nej |
| typeid | 1=For, 2=Imod, 3=Fravaer, 4=Blank | Ja | Ja - farvekode |

**Afledte beregninger fra stemmedata:**

| Beregning | Formel | Vis paa side? |
|-----------|--------|---------------|
| Fremmoede % | (For + Imod + Blank) / Total * 100 | Ja - noegletal |
| Partiloyalitet % | Stemmer ens med partiflertal / Sammenlignelige * 100 | Ja - noegletal |
| Stemmer for (antal) | count(typeid=1) | Ja - profilkort |
| Stemmer imod (antal) | count(typeid=2) | Ja - profilkort |
| Fravaer (antal) | count(typeid=3) | Ja - profilkort |
| Blank (antal) | count(typeid=4) | Evt. |
| Kontroversielle stemmer | Afstemninger hvor MF stemte mod eget parti | Ja - highlight |

### 1.5 Sager (lovforslag, beslutningsforslag)

**Endpoint:** `/api/Sag`

| Felt | Beskrivelse | Relevant? | Vis paa side? |
|------|-------------|-----------|---------------|
| id | Sag-ID | Ja (kobling) | Nej |
| titel | Fuld titel paa forslaget | Ja | Ja - i stemmeliste |
| typeid | 3=Lovforslag, 5=Beslutningsforslag, 9=Foresporgsel | Ja | Ja - type-badge |
| statusid | Status (vedtaget, forkastet, etc.) | Ja | Ja - farvekode |
| kategori | Emneomraade | Ja | Evt. filter |
| nummer | "L 92", "B 45" | Ja | Ja - identifikation |
| resume | Kort beskrivelse | Delvist | Evt. tooltip |

### 1.6 Dokumenter

**Endpoint:** `/api/Dokument`

| Felt | Beskrivelse | Relevant? | Vis paa side? |
|------|-------------|-----------|---------------|
| titel | Dokumenttitel | Delvist | Nej i v1 |
| filurl | URL til PDF paa ft.dk | Delvist | Evt. link |

**Vurdering:** Lav prioritet for MVP. Dokumenter er for tekniske til maalgruppen.

### 1.7 Moeder og taler

**Endpoint:** `/api/Moede`, `/api/Tale` (via referater i XML)

| Data | Beskrivelse | Relevant? | Vis paa side? |
|------|-------------|-----------|---------------|
| Antal taler i salen | Hvor ofte taler MF i salen | Delvist | Evt. som aktivitetsindikator |
| Ordfoerertaler | Taler som ordforer for parti | Delvist | Evt. som "aktive omraader" |
| Referater (XML) | Fulde referater fra Folketingssalen | Nej | For tungt, for teknisk |

**Vurdering:** Interessant men lavt udbytte for hoej indsats. v2+.

### 1.8 Paragraf 20-spoergsmaal

**Endpoint:** `/api/Sag?$filter=typeid eq 8` (ca.)

| Data | Beskrivelse | Relevant? | Vis paa side? |
|------|-------------|-----------|---------------|
| Antal spoergsmaal stillet | Aktivitetsmaal | Ja | Evt. noegletal |
| Spoergsmaalstekst | Hvad spoerger MF om | Delvist | Evt. seneste 5 |
| Minister der svarer | Hvem svarer | Nej | Nej |

**Vurdering:** Medium prioritet. "Stiller 47 spoergsmaal om sundhed" giver god indikation af fokusomraader.

### 1.9 Perioder og samlinger

**Endpoint:** `/api/Periode`, `/api/Samling`

| Data | Beskrivelse | Relevant? | Vis paa side? |
|------|-------------|-----------|---------------|
| Valgperioder | Start/slut paa valgperioder | Ja | Kontekst for anciennitet |
| Samlinger | Folketingsaar (okt-okt) | Ja | Filter/gruppering |

### 1.10 Samlet ODA-featureliste med status (faktisk brug)

Status er vurderet ud fra nuvaerende kode (`scripts/fetch_data.py`) og
frontend-forbrug (`profile.js`, `discover.js`, `parties.js`, `votes.js`).

| ODA-feature / information | Hvordan det kan udtraekkes | Bruger vi det nu? | Hvor bruges det |
|---|---|---|---|
| MF-stamdata (navn, fornavn, efternavn, start/slut, parti-kortkode) | `Aktør` (`typeid=5`) | Ja | Profiler, discover, soegning |
| MF-biografi XML (titel, profession, uddannelse, jobhistorik, kontakt) | `Aktør.biografi` (XML parse) | Ja | Profilside og profilkort |
| Officiel medlemsside-link | `Aktør.biografi -> url` | Ja | Profilside "Kilde" |
| Portraet-link fra FT-biografi | `Aktør.biografi -> picture*` | Ja | Profilfoto fallback |
| Parti-aktorer | `Aktør` (`typeid=4`) | Ja | Partioversigt, profilmapping |
| Udvalgs-aktorer | `Aktør` (`typeid=3`) | Ja | Udvalgslister og filtre |
| Parti-medlemskab (nuvaerende + historik) | `AktørAktør` + dato-felter | Ja | Profil, partihistorik, loyalitet |
| Udvalgsmedlemskab (aktive paa dato) | `AktørAktør` + dato-felter | Ja | Profil, discover-filter, partioversigt |
| Relationenes tidsdimension | `AktørAktør.startdato/slutdato` | Ja | Historik og korrekt parti paa afstemningstidspunkt |
| Storkreds (udledt fra biografi) | `Aktør.biografi` | Ja | Discover-filter, profiloversigt |
| Afstemningsvindue for valgt periode | `Sagstrin` filter med `Afstemning/any()` | Ja | Dataafgraensning + site_stats |
| Afstemningsliste (id, dato, nummer, type, vedtaget) | `Sagstrin` + `Afstemning` | Ja | Afstemningssiden |
| Afstemningskommentar (fx fejlstemme-note) | `Afstemning.kommentar` | Ja | Afstemningsdetalje |
| Sagstitel, kort titel, resume, sagsnummer | `Sagstrin -> Sag` | Ja | Afstemningsliste, detalje, soegning |
| Sagstrin-type og titel | `Sagstrin` + `Sagstrinstype` | Ja | Afstemningsdetalje (kontekst) |
| Individuelle stemmer per afstemning | `Afstemning/Stemme` (expand + overflow pages) | Ja | Ja/nej-lister, fordelinger, noegletal |
| Stemmetype-lookup (for/imod/fravaer/hverken) | `Stemmetype` | Ja | Profil noegletal + recent votes |
| Afstemningstype-lookup | `Afstemningstype` | Ja | Afstemningskicker/type |
| Vote groups (for/imod/fravaer/hverken) | Udledt fra `Stemme.typeid` | Ja | Afstemningsdetalje |
| Vote groups per parti | `Stemme` + parti paa afstemningsdato | Ja | Partifilter og partisplit |
| Taette afstemninger | Udledt af ja/nej-margin | Ja | Filter/sortering paa afstemningssiden |
| Partisplit-indikator | Udledt af intern partistemmefordeling | Ja | Afstemningssiden |
| Fremmoedeprocent | Udledt af `Stemme` | Ja | Profil og sortering |
| Partiloyalitet | Udledt af `Stemme` + partiflertal | Ja | Profil og sortering |
| Seneste afstemninger per MF | Udledt af `Stemme` + `Sag` | Ja | Profilsektion "seneste afstemninger" |
| Site-statistik (antal profiler, afstemninger, stemmer) | Udledt af hele ODA-udtraekket | Ja | Header + forside |
| Forespoergsler og redegoerelser (F/R) | `Periode` + `Sag` (`typeid=2/11`) | Ja | `data/ft_dokumenter_rf.json` / afstemningskontekst |
| Forslagsforløb/tidslinje per sag | `Sagstrin` + `Sagstrinstype` + `Sagstrinsstatus` | Ja | Afstemningsdetalje (forløb fra fremsættelse til afgørelse) |
| SagDokument/Dokument/Fil links | `SagDokument -> Dokument/Fil` | Nej (stadig deaktiveret) | Ikke i nuvaerende pipeline (performance) |
| Samling-entity direkte | `Samling` | Nej | Ikke hentet i nuvaerende pipeline |
| Moeder | `Moede` | Nej | Ikke implementeret |
| Taler / salsaktivitet | `Tale` | Nej | Ikke implementeret |
| Paragraf 20-aktivitet | `Sag` filtreret paa relevant type | Nej | Ikke implementeret |
| Afstemninger uden for nuvaerende startdato-vindue | Samme endpoints, bredere tidsfilter | Nej | Bevidst scope-afgraensning (`2022-11-01` -> i dag) |
| Individuel stemmebegrundelse per MF | Ikke tilgaengelig i `Stemme` | Nej (ikke muligt direkte) | ODA har ikke personligt begrundelsesfelt per stemme |
| Sagstype-/status-/kategori-opslag | `Sagstype`, `Sagsstatus`, `Sagskategori` | Nej | Kun delvist afledt via `Sag` felter, ikke fuldt udnyttet |
| Sagstrin-statusopslag | `Sagstrinsstatus` | Ja | Bruges i forslagstidslinje |
| Sagstrin-aktorer og roller | `SagstrinAktør`, `SagstrinAktørRolle` | Nej | Ikke implementeret |
| Sag-aktorer og roller (ordfoerer, minister, mv.) | `SagAktør`, `SagAktørRolle` | Nej | Ikke implementeret |
| Dagsorden for moeder | `Dagsordenspunkt`, `DagsordenspunktSag`, `DagsordenspunktDokument` | Nej | Ikke implementeret |
| Debatdata | `Debat` | Nej | Ikke implementeret |
| Moedeplan + moedeaktorer | `Møde`, `MødeAktør`, `Mødetype`, `Mødestatus` | Nej | Ikke implementeret |
| Dokumentmetadata (typer, status, kategorier) | `Dokument*` lookups | Nej | Kun indirekte overvejet via dokumentlinks |
| Dokument-til-aktør relationer | `DokumentAktør`, `DokumentAktørRolle` | Nej | Ikke implementeret |
| Sagstrin-dokument relationer | `SagstrinDokument` | Ja | Bruges til dokumentlinks pr. behandlingstrin |
| Emneords-klassifikationer | `Emneord`, `Emneordstype`, `EmneordSag`, `EmneordDokument` | Nej | Ikke implementeret |
| EU-sager | `EUsag` | Nej | Ikke implementeret |
| Forslag/aktstykker/almdel/omtryk | `Forslag`, `Aktstykke`, `Almdel`, `Omtryk` | Nej | Ikke implementeret |
| Sambehandlinger af sager | `Sambehandlinger` | Nej | Ikke implementeret |

---

## KILDE 2: ft.dk (hjemmeside, krsver scraping)

**Adgang:** HTTPS, men returnerer 403 paa mange sider for bots. Krav: browser-headers eller Selenium.
**Format:** HTML (ustruktureret)
**Opdatering:** Loebende

### 2.1 Hvervregisteret (oekonomiske interesser)

**URL:** `ft.dk/da/medlemmer/hverv-og-oekonomiske-interesser`

| Data | Beskrivelse | Relevant? | Vis paa side? | Tilgaengelighed |
|------|-------------|-----------|---------------|-----------------|
| Bestyrelsesposter | Hvem sidder i hvilke bestyrelser | Ja - hoej transparensvaerdi | Ja - liste | Scraping |
| Bijobs | Loennet arbejde ved siden af | Ja | Ja - liste | Scraping |
| Selvstaendig virksomhed | Eget firma/CVR | Ja | Ja - med CVR-link | Scraping |
| Selskabsinteresser | Aktier/investeringer over 50.000 kr | Ja | Ja - liste | Scraping |
| Foreningsmedlemskaber | VL-grupper, organisationer | Delvist | Evt. udvalgte | Scraping |
| "Ikke registreret" status | MF'ere der naegter at registrere | Ja - nyhedsvaerdi | Ja - tydeligt markeret | Scraping |

**VIGTIGT:** Obligatorisk siden 2014, men frivilligt at efterleve. Nogle MF'ere har tomme registreringer. Det er i sig selv interessant information. Vis "Ingen registrering i hvervregisteret" som en faktuel observation.

### 2.2 Ministeroplysningsskemaer (PDF)

**URL:** Regeringens hjemmeside (stm.dk)

| Data | Beskrivelse | Relevant? | Vis paa side? | Tilgaengelighed |
|------|-------------|-----------|---------------|-----------------|
| Hverv (5 aar) | Tidligere poster | Ja | Ja - tidslinje | PDF-parsing |
| Selvstaendig virksomhed | CVR, omsaetning >50k | Ja | Ja - med CVR-link | PDF-parsing |
| Selskabsinteresser | Investeringer >50k | Ja | Ja - liste | PDF-parsing |
| Aftaler m. tidl. arbejdsgivere | Oekonomi-aftaler | Ja | Ja - liste | PDF-parsing |
| Foreningsmedlemskaber | Foreninger, VL-grupper | Delvist | Evt. | PDF-parsing |
| Aegtafaelles hverv | Partners job og virksomhed | Delvist | Diskutabelt - privatliv | PDF-parsing |
| Aegtafaelles selskabsinteresser | Partners investeringer | Delvist | Diskutabelt | PDF-parsing |

**OVERVEJELSE:** Aegtafaelledata er offentliggjort med samtykke og er relevant for at spotte interessekonflikter. Men Folkevalget boer vaere forsigtig med at fremhaeve partneres private oekonomi. Vis kun ministerens egne oplysninger i v1.

### 2.3 Ordforerskaber

**URL:** Partiernes egne hjemmesider (sf.dk, venstre.dk, moderaterne.dk, osv.)

| Data | Beskrivelse | Relevant? | Vis paa side? | Tilgaengelighed |
|------|-------------|-----------|---------------|-----------------|
| Ordforerpost | "Sundhedsordforer", "Klimaordforer" | Ja - hoej vaerdi | Ja - badge/tags | Scraping fra ~10 sider |
| Politisk ordforer | Saerlig rolle | Ja | Ja - fremhaeved | Scraping |
| Gruppeformand | Saerlig rolle | Ja | Ja - fremhaeved | Scraping |

**Vurdering:** Hoej vaerdi men hoej vedligeholdelse. Ordforerskaber skifter jaevnligt. Maaske manuelt vedligeholdt JSON-fil som start?

### 2.4 Portraetfotos

**URL:** `ft.dk/medlemmer/mf/[initialer]/[navn]`

| Data | Beskrivelse | Relevant? | Vis paa side? | Tilgaengelighed |
|------|-------------|-----------|---------------|-----------------|
| Officielt portraetfoto | Headshot | Ja - allerede brugt | Ja - profilkort + profilside | Frit tilgaengeligt med kreditering |

**Licens:** Ophavsret tilhoerer Folketinget. Maa frit gengives med kildeangivelse og kreditering af fotograf. Maa IKKE aendres, manipuleres eller goeres til genstand for selvstaendig kommerciel udnyttelse.

**Handling:** Tilfoej "Foto: Folketinget / [fotograf]" i footer eller under billede.

### 2.5 Tal og regnskaber

**URL:** `ft.dk/da/organisation/folketingets-adminstration/folketingets-regnskaber`

| Data | Beskrivelse | Relevant? | Vis paa side? | Tilgaengelighed |
|------|-------------|-----------|---------------|-----------------|
| Gruppestoette per parti | Tilskud til folketingsgrupper | Delvist | Evt. paa partioversigt | PDF |
| Partistoette per parti | Offentlig partistoette | Delvist | Evt. paa partioversigt | PDF |
| Rejseudgifter | Aggregeret per gruppe | Delvist | Evt. | PDF |

**Vurdering:** Interessant for en partioversigtsside, men ikke per-politiker. Lav prioritet.

### 2.6 Vederlag og vilkaar

**URL:** `ft.dk/da/medlemmer/medlemmernes-vilkaar`

| Data | Beskrivelse | Relevant? | Vis paa side? |
|------|-------------|-----------|---------------|
| Grundvederlag | 1.100.000 kr/aar (nye regler fra naeste valg) | Ja | Ja - "Hvad faar en MF?" sektion |
| Omkostningstellaeg | 69.931 kr/aar skattefrit (nuvaerende regler) | Ja | Ja - samlet |
| Ministertillaeg | ~900.000 kr ekstra for ministre | Ja | Ja - for ministre |
| Pensionsregler | Livslang pension efter 1 aar (nuv.) / pensionsbidrag 18% (nye) | Ja | Ja - baggrundsfakta |
| Boliggodtgoerelse | For MF'ere uden bopael paa Sjaelland | Delvist | Evt. |
| Eftervederlag | 1-24 mdr. efter udtraeden | Delvist | Evt. |

**Vurdering:** Relevant som baggrundsinformation. Vis paa en "Om Folketinget" eller "Saadan virker det" side, ikke per profil. Generel info, ikke individuel.

---

## KILDE 3: Danmarks Statistik

**Adgang:** API (beta) via `api.statbank.dk`
**Format:** JSON/CSV
**Autentificering:** Ingen

### 3.1 Valgresultater

**Statistikbanken:** FVPCT, FVBPCT

| Data | Beskrivelse | Relevant? | Vis paa side? |
|------|-------------|-----------|---------------|
| Stemmeprocent per storkreds | Valgdeltagelse | Delvist | Evt. paa storkreds-side |
| Personlige stemmer per kandidat | Individuel opbakning | Ja | Ja - paa profil |
| Partifordeling per storkreds | Mandatfordeling | Delvist | Evt. paa storkreds-side |
| Historisk stemmeprocent | Udvikling over tid | Nej | Nej |

**Vurdering:** Personlige stemmer er relevant og interessant. Viser hvor stor opbakning en politiker har i sin storkreds.

### 3.2 Demografisk repraesentativitet

**Statistikbanken:** Diverse tabeller

| Data | Beskrivelse | Relevant? | Vis paa side? |
|------|-------------|-----------|---------------|
| Koensfordeling i FT | 39% kvinder (2022) | Delvist | Evt. paa statistikside |
| Aldersfordeling i FT | Gennemsnit 46.2 aar | Delvist | Evt. paa statistikside |
| Uddannelsesfordeling | 47% lang videregaaende | Delvist | Evt. sammenligning |

**Vurdering:** Interessant for en "Folketinget i tal" feature, men ikke kerneprodukt.

---

## KILDE 4: DR (Danmarks Radio)

**Adgang:** `dr.dk/feature/folketingets-medlemmer`
**Format:** HTML/JavaScript

| Data | Beskrivelse | Relevant? | Vis paa side? |
|------|-------------|-----------|---------------|
| MF-oversigt med parti/alder/koen | Filtreret visning | Nej - duplikerer ODA | Nej |
| Personlige stemmer ved valg | Stemmer per kandidat per storkreds | Ja | Ja - paa profil |
| Kandidattest/valgresultater | Detaljerede valgresultater | Delvist | Evt. link |

**Vurdering:** DR's data er primaert en visning af ODA + DST data. Brug originalkilderne.

---

## KILDE 5: Erhvervsstyrelsen (CVR-registeret)

**Adgang:** `datacvr.virk.dk/data/` (API) eller `cvr.dk` (soegning)
**Format:** JSON
**Autentificering:** Gratis registrering

| Data | Beskrivelse | Relevant? | Vis paa side? |
|------|-------------|-----------|---------------|
| Bestyrelsesposter | Alle CVR-registrerede poster | Ja | Ja - verificerbar data |
| Virksomhedsejerskab | Ejerskab i selskaber | Ja | Ja - transparens |
| Reelle ejere | Beneficial ownership | Ja | Ja - transparens |
| Tegningsregler | Hvem kan forpligte selskabet | Nej | Nej |
| Regnskaber | Aarsregnskaber for selskaber | Delvist | Evt. link |

**Vurdering:** Guldmine for transparens. CVR-data bekraefter (eller modsiger) hvervregisterets oplysninger. Kan krydstjekkes automatisk. Medium-hoej prioritet.

---

## KILDE 6: Retsinformation

**Adgang:** `retsinformation.dk` + API
**Format:** JSON/XML

| Data | Beskrivelse | Relevant? | Vis paa side? |
|------|-------------|-----------|---------------|
| Lovtekster | Fulde lovtekster | Nej | Nej - for teknisk |
| Lovforslag (L-numre) | Koblet til afstemninger | Ja | Ja - link fra stemmeliste |
| Lovens status | Gaeldende/ophaevet | Delvist | Evt. |

**Vurdering:** Primaert som link-kilde. Naar en bruger ser "L 92 - Om CO2-fangst", kan der linkes til retsinformation.dk for lovteksten.

---

## KILDE 7: Partisider (10 partier)

**Adgang:** Individuelle hjemmesider
**Format:** HTML (varierende struktur)

| Parti | URL | Data tilgaengeligt |
|-------|-----|-------------------|
| Socialdemokratiet (S) | socialdemokratiet.dk | MF-liste, ordforerskaber, politiske maal |
| Venstre (V) | venstre.dk/personer/ordfoerere | MF-liste, ordforerskaber |
| SF | sf.dk/dine-politikere | MF-liste, ordforerskaber (detaljeret) |
| Liberal Alliance (LA) | liberalalliance.dk | MF-liste |
| Konservative (KF) | konservative.dk/politikere | MF-liste |
| Dansk Folkeparti (DF) | danskfolkeparti.dk | MF-liste |
| Enhedslisten (EL) | enhedslisten.dk | MF-liste, partiskat-info |
| Moderaterne (M) | moderaterne.dk/folketingsmedlemmer | MF-liste, ordforerskaber (detaljeret) |
| Danmarksdemokraterne (DD) | danmarksdemokraterne.dk | MF-liste |
| Radikale Venstre (RV) | radikale.dk | MF-liste |
| Alternativet (AA) | alternativet.dk | MF-liste |

**Unik data fra partisider:**

| Data | Beskrivelse | Relevant? | Vis paa side? |
|------|-------------|-----------|---------------|
| Ordforerskaber | Hvem er ordforer for hvad | Ja | Ja - tags |
| Kontaktinfo (email, tlf) | Direkte kontakt til MF | Ja | Ja - paa profilside |
| Partipolitiske maal | Hvad partiet vil | Nej | Nej - subjektivt |
| Lokale arrangementer | Events | Nej | Nej |

**Saerligt for Enhedslisten:** Offentliggoer partiskat-beregning. MF'ere afleverer stor del af vederlag. Det er unik transparensinfo, men maaske for partiskspecifikt.

---

## KILDE 8: Regeringens hjemmeside (stm.dk)

**Adgang:** `stm.dk`
**Format:** HTML + PDF

| Data | Beskrivelse | Relevant? | Vis paa side? |
|------|-------------|-----------|---------------|
| Ministerliste | Aktuelle ministre | Ja | Ja - minister-tag |
| Ministeromraader | Hvem har ansvar for hvad | Ja | Ja - paa ministerprofiler |
| Oplysningsskemaer (PDF) | Oekonomiske interesser for ministre | Ja | Ja - se kilde 2.2 |
| Regeringsgrundlag | Politisk aftale | Delvist | Evt. link |

---

## KILDE 9: Hoeringsportalen

**Adgang:** `hoeringsportalen.dk`
**Format:** HTML

| Data | Beskrivelse | Relevant? | Vis paa side? |
|------|-------------|-----------|---------------|
| Aktuelle hoeringer | Lovforslag i hoering | Delvist | Evt. link fra lovforslag |
| Hoeringsvar | Hvem har svaret | Nej | For teknisk |

**Vurdering:** v3+. Interessant men ikke kerneprodukt.

---

## SAMMENFATNING: Hvad vises hvor paa Folkevalget.dk

### PROFILKORT (discover-siden)

| Datapunkt | Kilde | Prioritet |
|-----------|-------|-----------|
| Navn | ODA Aktoer | Implementeret |
| Foto | ft.dk (med kreditering) | Implementeret |
| Parti + partiforkortelse | ODA Aktoer | Implementeret |
| Profession/beskaftigelse | ODA Aktoer (biession) | Implementeret |
| Registrerede stemmer | ODA Stemme (beregnet) | Implementeret |
| Antal udvalg | ODA AktoerAktoer | Implementeret |
| Fremmoede % | ODA Stemme (beregnet) | Implementeret |
| Partiloyalitet % | ODA Stemme (beregnet) | Implementeret |
| Stemmer for / imod | ODA Stemme (beregnet) | Implementeret |
| **Storkreds** | **ODA AktoerAktoer** | **MVP - ny** |
| **Minister-tag** | **ODA biografi / stm.dk** | **MVP - ny** |
| **Ny/erfaren-tag** | **ODA Aktoer startdato** | **MVP - ny** |

### PROFILSIDE (profil.html)

| Sektion | Datapunkter | Kilde | Prioritet |
|---------|-------------|-------|-----------|
| Header | Navn, foto, parti, profession | ODA | Implementeret |
| Noegletal | Fremmoede, loyalitet, for/imod/fravaer | ODA Stemme | Implementeret |
| Forklaring | "Hvordan laeses tallene" | Statisk tekst | Implementeret |
| Udvalg | Aktive udvalg med ft.dk-links | ODA AktoerAktoer | Implementeret |
| Seneste afstemninger | Stemmeliste med dato/titel/resultat | ODA Stemme+Sag | Implementeret |
| **Storkreds** | **Valgt i [storkreds]** | **ODA AktoerAktoer** | **MVP - ny** |
| **Minister-info** | **Tag + "Minister deltager sjaldent i afstemninger"** | **ODA biografi** | **MVP - ny** |
| **Uddannelse** | **Kort format: "Cand.jur., KU"** | **ODA biografi (parse)** | **v1.1** |
| **Beskaftigelse foer FT** | **"Selvstaendig konsulent, 1990-95"** | **ODA biografi (parse)** | **v1.1** |
| **Partihistorik** | **Tidslinje: V (1994-2020) -> M (2022-)** | **ODA AktoerAktoer / biografi** | **v1.1** |
| **Anciennitet** | **"Medlem siden 1994 (32 aar)" / "Ny (2022)"** | **ODA Aktoer startdato** | **v1.1** |
| **Ordforerskaber** | **"Sundhedsordforer, Klimaordforer"** | **Partisider (scraping)** | **v1.2** |
| **Kontaktinfo** | **Email (ft.dk), evt. telefon** | **Partisider** | **v1.2** |
| **Hvervregister** | **Bestyrelsesposter, bijobs, selskabsinteresser** | **ft.dk scraping** | **v2** |
| **CVR-poster** | **Verificerede bestyrelsesposter** | **CVR API** | **v2** |
| **Ministeroplysninger** | **Oekonomiske interesser (kun ministre)** | **stm.dk PDF** | **v2** |
| **Personlige stemmer** | **X.XXX stemmer ved valget 2022** | **DST / DR** | **v2** |
| **Paragraf 20-spoergsmaal** | **"Har stillet 47 spoergsmaal om sundhed"** | **ODA Sag** | **v2** |
| **Taleaktivitet** | **Antal taler i salen** | **ODA Tale/Moede** | **v3** |

### PARTIOVERSIGT (ny side)

| Datapunkt | Kilde | Prioritet |
|-----------|-------|-----------|
| Gennemsnitligt fremmoede per parti | ODA (beregnet) | v1.1 |
| Gennemsnitlig loyalitet per parti | ODA (beregnet) | v1.1 |
| Antal MF'ere | ODA | v1.1 |
| Partileder | ODA biografi / partisider | v1.1 |
| Politisk ordforer | Partisider | v1.2 |
| Gruppestoette (kr) | ft.dk regnskaber | v2 |
| Partistoette (kr) | ft.dk regnskaber | v2 |

### AFSTEMNINGSBROWSER (ny side)

| Datapunkt | Kilde | Prioritet |
|-----------|-------|-----------|
| Afstemningsliste med dato/titel/resultat | ODA Afstemning + Sag | v1.1 |
| For/imod fordeling per parti | ODA Stemme (aggregeret) | v1.1 |
| Taette afstemninger (51-49%) | ODA (beregnet) | v1.2 |
| Partisplits (uenighed internt) | ODA (beregnet) | v1.2 |
| Link til lovtekst | Retsinformation | v1.2 |

### STORKREDSOVERSIGT (ny side/filter)

| Datapunkt | Kilde | Prioritet |
|-----------|-------|-----------|
| MF'ere per storkreds | ODA AktoerAktoer | v1.1 |
| Valgdeltagelse per storkreds | DST | v2 |
| Personlige stemmer per kandidat | DST / DR | v2 |

### BAGGRUNDSSIDER

| Side | Indhold | Kilde | Prioritet |
|------|---------|-------|-----------|
| "Saadan virker det" | Lovgivningsprocessen visualiseret | Statisk | v1.1 |
| "Om Folketinget" | Vederlag, vilkaar, regler | ft.dk | v1.2 |
| "Om data" | Kilder, metode, begransninger | Statisk | MVP |
| "Hvad er fremmoede?" | Forklaring inkl. ministerforbeholdet | Statisk | MVP |

---

## PRIORITERET HANDLINGSPLAN

### MVP (foer valget 24. marts)
1. Storkreds-filter paa discover-siden (ODA data, allerede hentet)
2. Minister-tag paa profiler (parse biografi for "minister")
3. Forklaring paa fremmoedeberegning (statisk tekst om ministre)
4. "Ny i Folketinget" / anciennitetstag
5. Fotokreditering i footer

### v1.1 (uge 2 efter launch)
6. Uddannelse + beskaftigelse fra biografi-parsing
7. Partihistorik tidslinje
8. Partioversigtsside med aggregerede tal
9. Afstemningsbrowser (seneste afstemninger med partifordeling)
10. Storkredsoversigt

### v1.2 (uge 3-4)
11. Ordforerskaber (manuelt vedligeholdt JSON som start)
12. Kontaktinfo (email fra ft.dk)
13. Taette afstemninger / partisplits
14. "Saadan virker Folketinget" guide
15. Sammenlign-funktion (2-3 politikere side om side)

### v2 (efter valget)
16. Hvervregister-integration (scraping)
17. CVR-krydstjek
18. Ministeroplysningsskemaer (PDF-parsing)
19. Personlige stemmer fra valg
20. Paragraf 20-spoergsmaal
21. "Match mig" quiz (10 kontroversielle afstemninger)

### v3 (langsigtet)
22. Taleaktivitet og salsstatistik
23. Hoeringsportal-integration
24. Kommunale data (naar/hvis API bliver tilgaengeligt)
25. EU-parlamentsdata for danske MEP'ere
26. Historisk sammenligning (valgperiode vs. valgperiode)

---

## NOTER OM DATAKVALITET

### Kendte problemer
- **Biografi-feltet** varierer enormt i kvalitet. Nogle MF'ere har 2 linjer, andre har 50. Aldrig antag at et felt er udfyldt.
- **Fremmoede for ministre** er misvisende lavt. Ministre stemmer sjaldent fordi de er i ministeriet, ikke i salen. ALTID vis forklaring.
- **Faeroeske/groenlandske MF'ere** deltager ofte ikke i alle afstemninger. Overvej saerlig haandtering.
- **Stedfortraedere** kan have meget faa stemmer. De er teknisk set MF'ere men har kort funktionstid.
- **Partiskift** - en MF der skifter parti midt i perioden faar sine gamle stemmer regnet under det gamle parti. Vurdeer om loyalitet skal beregnes per partiperiode.
- **Hvervregisteret** er frivilligt at udfylde korrekt. Manglende data =/= ingen interesser.

### Designprincipper for datahull
1. Vis aldrig tomme felter som fejl - skjul sektionen
2. Vis "Ingen data tilgaengelig" kun for felter der BURDE vaere udfyldt (fx hvervregisteret)
3. En profil med kun navn + parti + storkreds + 5 stemmer er stadig nyttig
4. Link altid til originalkilde (ft.dk) saa brugeren kan verificere
5. Vsr tydeligt dato for seneste dataopdatering

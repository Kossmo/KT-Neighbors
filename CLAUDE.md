# Projet : Neighbors

*(Bestiaire local)*

## Concept
Expérience web qui révèle la biodiversité autour de l'utilisateur. À partir d'une adresse ou de la géolocalisation, on découvre les espèces observées dans un rayon donné, avec photos et fiches. L'objectif est de donner un sentiment d'émerveillement sur le vivant local, souvent invisible au quotidien.

## Stack réelle (implémentée)
- **Framework** : Angular 21, standalone components, signals, OnPush
- **Carte** : Leaflet (lazy `import('leaflet')`), tuiles CartoDB Positron
- **Géocodage** : Nominatim (forward + reverse)
- **API espèces** : GBIF occurrences + iNaturalist taxa + Wikipedia EN REST
- **Style** : SCSS avec `@use`, partials `_variables.scss`, `_paper.scss`, `_reset.scss`
- **Fonts** : Amatic SC (titre espèce uniquement : `.detail__common-name`) + Lora (tout le reste)
- **Déploiement** : Docker multi-stage (node:22-alpine → nginx:alpine) + Coolify

## APIs utilisées

### GBIF
- Occurrences : `https://api.gbif.org/v1/occurrence/search`
- Params : `geoDistance=lat,lon,Xkm`, `mediaType=StillImage`, `basisOfRecord=HUMAN_OBSERVATION`, `hasCoordinate=true`, `hasGeospatialIssue=false`
- Pagination : 2 pages de 300 résultats via `forkJoin`

### iNaturalist
- `https://api.inaturalist.org/v1/taxa/autocomplete?q={scientificName}` — photos HD + noms communs

### Wikipedia
- `https://en.wikipedia.org/api/rest_v1/page/summary/{title}` — description courte + URL

### Nominatim
- Forward : `https://nominatim.openstreetmap.org/search?q={address}&format=json`
- Reverse : `https://nominatim.openstreetmap.org/reverse?lat=&lon=&format=json`

## Fonctionnalités implémentées

### Landing
- Choix entre géolocalisation browser ou saisie d'adresse
- Gestion des erreurs inline (géoloc refusée → reste sur idle, affiche message)

### Discovery (`/discovery?lat=&lon=`)
- Grille 400px | 1fr (liste gauche, carte droite)
- **Barre de recherche** : filtre sur scientificName, vernacularName, kingdom, phylum, class, order, family, genus
- **Radius slider** : change le rayon de recherche et relance le fetch
- **Kingdom chips** : filtres par règne avec couleurs distinctives (CSS custom properties `--chip-bg`, `--chip-border`)
- Ordre des contrôles dans le panel : search → radius → kingdom chips → liste
- Compteur "N / total species · Xkm" quand un filtre est actif
- Cache localStorage 24h (clé géohash ~2km)

### Carte (Leaflet)
- Tuiles : CartoDB Positron (fond blanc épuré, lignes grises fines)
- 3 états de pin : active (ochre `#c4873a`), selected (ochre foncé `#9a5f1e` + halo ochre), dimmed (gris neutre transparent)
- Cercle de rayon en pointillés ochre, fill quasi invisible
- Dot de position utilisateur : ochre + contour blanc
- Clic sur pin → navigate vers fiche détail
- Render order : dimmed en premier, selected en dernier (z-layering)
- Zoom control déplacé en `topleft` pour libérer le coin `topright`

### Heatmap
- Bouton toggle "Heat map / Pins" en haut à droite de la carte (visible quand status=success)
- Canvas overlay Leaflet (z-index 450) avec dégradés radiaux accumulés par densité (bleu-vert `#4a6a7a` → transparent)
- **12 mois glissants** excluant le mois en cours : de M-12 à M-1 inclus
- Barre de contrôles en bas de carte : play/pause + timeline 12 segments + label du mois actif (ex: "May '25")
- Animation automatique au passage en mode heatmap, 2,5s/mois, boucle sur 12 mois (30s cycle)
- Clic sur un segment → pause + saut au mois voulu
- La liste d'espèces se synchronise avec le mois actif (filtre par `year` ET `month`)
- `SpeciesObservation` contient `month` et `year` (propagés depuis GBIF)
- `heatSlots` calculé dans `DiscoveryComponent`, passé en input au `MapComponent`
- `monthChanged` output du `MapComponent` → `heatMonth` signal dans `SpeciesStore`

### Fiche détail (`/species/:taxonKey`)
- Layout deux colonnes : photo sticky gauche | infos scrollable droite
- **Photo slider** : la photo GBIF initiale ne change jamais ; si iNaturalist charge une photo différente, elle est ajoutée en slide 2 silencieusement (flèches + dots apparaissent, label source GBIF/iNaturalist)
- Stats : occurrenceCount, famille, règne
- Description Wikipedia avec skeleton loading
- Taxonomie complète (Kingdom → Genus)
- Mini-carte centrée sur le centroïde des observations

## Persistance des filtres et état UI

`searchQuery`, `selectedKingdoms`, `mapMode` et `heatMonth` vivent dans `SpeciesStore` (singleton) :
- **Retour depuis détail** → tout préservé (store.search() non appelé)
- **Aller sur home** (`goHome()`) → reset complet : filtres + mapMode('pins') + heatMonth(0)
- **Lancer depuis landing** (`navigateToDiscovery()`) → reset via `store.search()`
- **Nouvelle localisation** (`store.search()`) → reset inclus dans l'action

## Pièges et bugs résolus

### `effect()` dans le constructeur crée des dépendances réactives involontaires
Si l'effet lit `store.species()`, il se ré-exécute à chaque mise à jour du tableau — même depuis la fiche détail. → **Utiliser `ngOnInit()` pour les lookups one-shot.**

### `setInterval` dans un composant Angular avec signals
Utiliser `NgZone.runOutsideAngular()` pour éviter de polluer la zone Angular, les signals déclenchent eux-mêmes la détection de changements. Nettoyer avec `clearInterval` dans `ngOnDestroy`.

### Canvas overlay Leaflet
Ajouter le canvas sur `map.getContainer()` (pas dans un pane Leaflet) avec `position:absolute; top:0; left:0; pointer-events:none`. Redessiner sur les événements `move` et `zoom`. `latLngToContainerPoint([lat, lon])` donne les coordonnées pixel correctes même après un pan.

### Conflits z-index Leaflet
Le zoom control Leaflet est à `z-index: 1000` en `topright` — déplacer en `topleft` via `L.control.zoom({ position: 'topleft' })` après `zoomControl: false` dans les options map.

### `forkJoin` page 2 GBIF
`searchOccurrences()` retourne `GbifSearchResponse`, pas `GbifOccurrence[]`. Ajouter `.pipe(map(p2 => p2.results))` avant le `forkJoin` sinon le spread échoue silencieusement et le status reste bloqué sur `'loading'`.

### Coordonnée longitude = 0 filtrée à tort
`!occ.decimalLongitude` filtre les observations à longitude 0 (UK, Afrique de l'Ouest). → Utiliser `occ.decimalLongitude == null`.

### Scroll liste espèces cassé
`overflow-y: auto` sur la liste ne fonctionne pas si le parent flex n'a pas `min-height: 0`. → `:host { flex: 1; min-height: 0; overflow: hidden; }` sur `app-species-list`.

### `monthChanged` output écrase le mois stocké au démarrage du MapComponent
L'effet drawHeat dans le constructeur émet `monthChanged(0)` avant `ngAfterViewInit`, ce qui écrase `store.heatMonth` même quand il a une valeur préservée. → **Ne pas émettre `monthChanged` si `this.map` est null** (conditionner l'émission à `this.map && this.heatCanvas && this.L`).

### Restauration du mode heatmap après navigation
Quand `MapComponent` est recréé avec `mode='heatmap'`, l'effet de mode ne se re-déclenche pas (le signal n'a pas changé). → Initialiser le canvas et dessiner directement dans `ngAfterViewInit` si `mode() === 'heatmap'`, en utilisant l'input `initialHeatMonth` pour restaurer le bon mois.

## Structure du projet
```
src/
  app/
    core/
      api/          # gbif.service, inaturalist.service, wikipedia.service
      models/       # occurrence.model, species.model
      services/     # species-store (état global), geolocation.service, cache.service
      utils/        # species-aggregator (groupBy taxonKey, tri par count)
    features/
      landing/
      discovery/
        map/
        radius-slider/
        species-card/
        species-list/
      species-detail/
  styles/
    _variables.scss   # palette, fonts, spacing, breakpoints, easings
    _paper.scss       # grain overlay, mixins hand-border/latin-name/hand-heading
    _reset.scss       # CSS reset, prefers-reduced-motion
```

## Roadmap

### V2
- Filtres par groupe taxonomique (oiseaux, plantes, mammifères, insectes…) ✅ implémenté (kingdom chips)
- Carte avec pins pour chaque observation ✅ implémenté
- Heat map des observations par saison — animation d'un an en 30s ✅ implémenté (12 mois glissants)

### V3 — idées plus créatives
- **Arbre taxonomique interactif** (D3 tree) : classification (règne → espèce) des créatures trouvées près de toi
- **Jeu de reconnaissance** : photo + 4 noms possibles, pour apprendre la faune/flore locale
- **"Qui partage ton habitat ?"** : graphe force-directed des espèces et leurs liens phylogénétiques
- **"Safari du jour"** : une espèce tirée au sort chaque jour parmi celles du coin
- **Mode collection** : l'utilisateur coche les espèces qu'il a vues en vrai, comme un pokédex local

## Ressources
- Doc API GBIF : https://techdocs.gbif.org/en/openapi/v1/occurrence
- iNaturalist API : https://api.inaturalist.org/v1/docs/
- Référence taxonomique : https://www.gbif.org/species/search

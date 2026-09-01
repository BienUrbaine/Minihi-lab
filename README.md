# Minihi

Prototype web de préqualification d’un logement à partir de son adresse.

Minihi permet de consulter l’éligibilité d’un logement à un dispositif
d’accompagnement — rénovation, réhabilitation ou restauration — et de
rassembler dans une même interface les principales informations disponibles
sur les caractéristiques, l’enveloppe et le contexte du bâtiment.

**Prototype de démonstration — © Bien Rurbaine 2026 — Tous droits réservés.
Réutilisation ou redistribution sans autorisation interdite.**

## Démonstrateur

[Ouvrir Minihi-lab](https://bienurbaine.github.io/Minihi-lab/)

## Fonctionnalités

- recherche d’adresse via BAN / Géoplateforme (IGN) ;
- localisation dans les opérations programmées de l’Anah en cours en Bretagne lorsque la source fournit un périmètre géographique exploitable ;
- distinction cartographique des principaux types d’opérations (OPAH-RU, PIG, OPAH-D, POPAC) ;
- affichage du dispositif, de sa période et de son maître d’ouvrage ;
- consultation des zonages territoriaux intégrés au prototype ;
- rapprochement avec la BDNB Open et affichage des principales informations disponibles sur le bâtiment : usage, année, DPE, GES, chauffage et copropriété ;
- informations disponibles sur l’enveloppe : murs, planchers, toiture, vitrage, menuiseries et ventilation ;
- éléments de contexte de rénovation : patrimoine, réseau de chaleur, solaire thermique et géothermie ;
- cartographie Leaflet sur fond OpenStreetMap, avec mise en évidence de la Bretagne ;
- vue Google Street View chargée à la demande pour l’adresse sélectionnée.

## Sources et périmètre

Les principales sources mobilisées sont :

- opérations programmées de l’Anah en cours : jeu « Liste des opérations programmées de l’Anah en cours et terminées » diffusé sur data.gouv.fr ;
- BAN / Géoplateforme (IGN) pour la recherche d’adresse ;
- DREAL Bretagne, ANCT et INSEE pour les zonages intégrés au prototype ;
- BDNB Open pour les informations disponibles sur le bâtiment ;
- API Découpage administratif (geo.api.gouv.fr) pour le contour régional utilisé par la carte.

Le périmètre d’analyse est la Bretagne. La couverture cartographique des
opérations Anah dépend de la présence d’une géométrie Polygon ou MultiPolygon
exploitable dans la donnée source. Une opération sans géométrie n’est pas
artificiellement reconstituée.

## Architecture

Minihi est une application statique en HTML, CSS et JavaScript. Les données
territoriales nécessaires au prototype sont stockées localement et chargées
dans le navigateur. Les services externes sont interrogés uniquement pour les
fonctions qui le nécessitent, notamment la recherche d’adresse, la BDNB et
Street View.

L’application est conçue pour être déployée comme un site web statique et peut
également être testée via un serveur HTTP local.

Le script `scripts/update_anah_perimeters.py` permet de régénérer
`data/perimetres.geojson` à partir de la source nationale Anah en conservant
les opérations actives en Bretagne, tous opérateurs confondus. Les quelques
périmètres identifiés comme erronés dans la source sont explicitement exclus
lors de cette préparation.

## Développement et assistance LLM

Minihi est un prototype développé avec l’assistance d’outils fondés sur des
modèles de langage (LLM), utilisés notamment pour accélérer l’écriture, la
relecture et l’itération sur le code.

Cette assistance ne remplace pas la définition du besoin, le choix des sources,
la validation fonctionnelle ni la maintenance du prototype. Le code présent
dans ce dépôt est relu, testé sur les cas d’usage du démonstrateur et conservé
dans une architecture volontairement simple afin de faciliter sa compréhension
et sa reprise par un tiers.

Le dépôt doit être considéré comme un prototype fonctionnel et non comme une
application de production industrialisée. Une mise en production dans un
système d’information tiers peut nécessiter des adaptations d’hébergement,
de sécurité, de supervision, de gestion des secrets et de tests automatisés.

## Configuration de Google Street View

Street View utilise Maps Embed API en mode `streetview`. La clé Google Maps
Platform est isolée dans `streetview-config.js`.

La clé doit être restreinte au domaine sur lequel Minihi est déployé et limitée
à **Maps Embed API**. Pour des tests locaux, une origine `localhost` peut être
autorisée temporairement puis retirée avant mise en production.

Comme toute clé utilisée côté navigateur dans un site statique, elle reste
visible dans le code envoyé au navigateur : les restrictions de domaine et
d’API sont donc indispensables. Pour une reprise ou une industrialisation, la
configuration doit être séparée du code source et injectée au déploiement.
L’iframe Street View n’est chargée qu’à l’ouverture du panneau.

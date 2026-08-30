# Minihi

Carte web de consultation des périmètres d’aide au logement.

Prototype de démonstration — © Bien Rurbaine 2026 — Tous droits réservés. Réutilisation ou redistribution sans autorisation interdite.

## Carte publique

[Ouvrir la carte Minihi](https://bienurbaine.github.io/Minihi/)

## Fonctionnalités

- recherche d’adresse via le service public IGN / Géoplateforme ;
- affichage des opérations programmées de l’Anah en cours, filtrées à l’échelle de la Bretagne et pour un opérateur ;
- test spatial dans le navigateur ;
- affichage du dispositif, de sa période et de son maître d’ouvrage ;
- panneau Google Street View chargé à la demande pour l’adresse sélectionnée.

## Données

La couche publiée est issue du jeu de données « Liste des opérations programmées de l’Anah en cours et terminées » diffusé sur data.gouv.fr. Elle ne contient que les opérations en cours retenues pour le prototype.

## Publication

Le site est statique et conçu pour GitHub Pages. Ouvrir `index.html` via un serveur HTTP local pour le tester.

## Configuration de Google Street View

Street View utilise exclusivement Maps Embed API en mode `streetview`. La clé
Google Maps Platform est isolée dans `streetview-config.js`.

1. Créer ou sélectionner un projet dans Google Cloud et lui associer un compte de facturation.
2. Activer **Maps Embed API**.
3. Dans **Google Maps Platform > Identifiants**, créer une clé API.
4. Dans les restrictions d’application, choisir **Sites Web** et autoriser :
   - `https://bienurbaine.github.io/*`
   - `http://localhost:*/*` uniquement pendant les tests locaux, puis supprimer cette ligne en production.
5. Dans les restrictions d’API, limiter la clé uniquement à **Maps Embed API**.

La clé est nécessairement visible dans le code d’un site statique. Les
restrictions de site et d’API sont donc indispensables. L’iframe Street View
est chargée uniquement à l’ouverture du panneau.

La restriction porte sur l’origine GitHub Pages (`bienurbaine.github.io`) : la
politique de référent recommandée par Google ne transmet pas le chemin
`/Minihi/` aux API externes.

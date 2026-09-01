#!/usr/bin/env python3
"""Régénère data/perimetres.geojson depuis le jeu national ANAH.

Filtre : opérations en cours à la date d'exécution, région Bretagne,
tous opérateurs confondus. Les propriétés sont normalisées pour Minihi.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from urllib.request import urlopen

SOURCE_URL = "https://www.data.gouv.fr/api/1/datasets/r/1631e896-9670-4db8-92c9-35d6a0daa032"
OUTPUT = Path("data/perimetres.geojson")
BRETON_DEPARTMENTS = {"22", "29", "35", "56"}


def parse_iso(value):
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def has_usable_geometry(geometry):
    if not isinstance(geometry, dict):
        return False
    if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        return False
    coords = geometry.get("coordinates")
    return bool(coords)


def main():
    today = date.today()
    print(f"Téléchargement ANAH : {SOURCE_URL}")
    with urlopen(SOURCE_URL, timeout=120) as response:
        source = json.load(response)

    selected = []
    missing_geometry = []
    departments = Counter()
    operators = Counter()
    types = Counter()

    for feature in source.get("features", []):
        props = feature.get("properties") or {}
        region = str(props.get("libelleregion") or "").strip().upper()
        department = str(props.get("codedepartement") or "").strip()
        start = parse_iso(props.get("datedebut"))
        end = parse_iso(props.get("dateexpiration"))

        if region != "BRETAGNE":
            continue
        if department not in BRETON_DEPARTMENTS:
            continue
        if start is None or end is None or not (start <= today <= end):
            continue

        geometry = feature.get("geometry")
        normalized = {
            "type": "Feature",
            "properties": {
                "Label": props.get("nom"),
                "Type": props.get("typeprogramme"),
                "Date_debut": props.get("datedebut"),
                "Date_fin": props.get("dateexpiration"),
                "Maitre_ouvrage": props.get("maitreouvrage"),
                "Code": props.get("code"),
                "Operateur": props.get("operateur"),
                "Departement": department,
                "Territoire": props.get("territoire"),
            },
            "geometry": geometry,
        }
        selected.append(normalized)
        departments[department] += 1
        operators[str(props.get("operateur") or "Non renseigné")] += 1
        types[str(props.get("typeprogramme") or "Non renseigné")] += 1
        if not has_usable_geometry(geometry):
            missing_geometry.append(props.get("code") or props.get("nom") or "sans identifiant")

    selected.sort(key=lambda f: (
        str(f["properties"].get("Departement") or ""),
        str(f["properties"].get("Label") or ""),
        str(f["properties"].get("Code") or ""),
    ))

    output = {"type": "FeatureCollection", "features": selected}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(output, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(f"Date de référence : {today.isoformat()}")
    print(f"Opérations actives Bretagne : {len(selected)}")
    print("Par département :", dict(sorted(departments.items())))
    print("Types :", dict(types.most_common()))
    print(f"Opérateurs distincts renseignés : {sum(1 for k in operators if k != 'Non renseigné')}")
    print(f"Sans géométrie Polygon/MultiPolygon exploitable : {len(missing_geometry)}")
    if missing_geometry:
        print("Identifiants sans géométrie :")
        for item in missing_geometry:
            print(" -", item)

    if not selected:
        raise SystemExit("Aucune opération active bretonne trouvée.")
    if set(departments) != BRETON_DEPARTMENTS:
        print("ATTENTION : tous les départements bretons ne sont pas représentés.", file=sys.stderr)
    if len(operators) < 2:
        raise SystemExit("Le résultat ne contient pas plusieurs opérateurs : filtrage suspect.")


if __name__ == "__main__":
    main()

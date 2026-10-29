# Créditos de las imágenes

Las fotos de los datos de ejemplo (`prisma/fotos-seed/*.jpg`) son de [Unsplash](https://unsplash.com) y se usan bajo la [Licencia de Unsplash](https://unsplash.com/license): se pueden usar gratis, también con fines comerciales, sin pedir permiso. Ninguna es de Unsplash+. Se bajaron de la página de cada foto, redimensionadas a un máximo de 800 px del lado mayor, en JPG con calidad 80.

Se versionan acá porque `uploads/` no se versiona: el seed (`prisma/seed.ts`) copia cada `<clave>.jpg` a la carpeta de uploads como `seed-<clave>.jpg` y guarda en la base la ruta `/uploads/seed-<clave>.jpg`. La app no trae fotos de datos: las pide al servidor. Si se suma una foto, va en `prisma/fotos-seed/`, en `FOTOS_SEED` del seed y en esta tabla.

| Archivo | Qué representa en la app | Autor | Foto | Licencia |
| --- | --- | --- | --- | --- |
| `luna.jpg` | Luna, golden retriever de Sofía | Shayna Douglas | [unsplash.com/photos/rFao8fcvTdY](https://unsplash.com/photos/a-dog-sitting-in-the-grass-with-its-tongue-out-rFao8fcvTdY) | Unsplash License |
| `roco.jpg` | Roco, bulldog francés de Sofía | Raelle Cameron | [unsplash.com/photos/nk7XHNafPQ4](https://unsplash.com/photos/a-french-bulldog-puppy-sits-on-a-grey-couch-nk7XHNafPQ4) | Unsplash License |
| `milo.jpg` | Milo, mestizo de Sofía (y su reporte de encontrado) | Catarina Carvalho | [unsplash.com/photos/1K7Qf8OBXjU](https://unsplash.com/photos/short-coat-brown-and-white-dog-sitting-near-gray-concrete-wall-during-daytime-1K7Qf8OBXjU) | Unsplash License |
| `toby.jpg` | Toby, beagle de Lucía | Milli | [unsplash.com/photos/2l0CWTpcChI](https://unsplash.com/photos/2l0CWTpcChI) | Unsplash License |
| `pipa.jpg` | Pipa, border collie de Julián (y su reporte de perdida) | Will Gardiner | [unsplash.com/photos/CxoEcLLdROc](https://unsplash.com/photos/black-and-white-border-collie-CxoEcLLdROc) | Unsplash License |
| `sofia.jpg` | Foto de perfil de Sofía Romero | Jake Nackos | [unsplash.com/photos/IF9TK5Uy-KI](https://unsplash.com/photos/IF9TK5Uy-KI) | Unsplash License |
| `lucia.jpg` | Foto de perfil de Lucía Gómez | Štefan Štefančík | [unsplash.com/photos/QXevDflbl8A](https://unsplash.com/photos/QXevDflbl8A) | Unsplash License |
| `julian.jpg` | Foto de perfil de Julián Fernández | Christian Buehner | [unsplash.com/photos/DItYlc26zVI](https://unsplash.com/photos/smiling-man-with-glasses-and-beard-portrait-DItYlc26zVI) | Unsplash License |

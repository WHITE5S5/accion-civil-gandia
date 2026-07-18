# Registro de Actividades de Tratamiento (RGPD art. 30)

> Acción Civil Gandia · Responsable del tratamiento: **Acción Civil Gandia** (partido político local, Gandia, Valencia).
> Documento vivo — actualizar ante cualquier nuevo tratamiento o encargado. Última revisión: 2026-07-09.

**Nota art. 37**: por tratar categorías especiales (afiliación política, art. 9) a escala relevante, evaluar la designación de un **Delegado de Protección de Datos (DPD)** y una **Evaluación de Impacto (EIPD)** antes de activar afiliación/donaciones online (Fase 4).

Base jurídica común: RGPD (UE) 2016/679 y LOPDGDD 3/2018. Datos alojados en la **UE** (Supabase Frankfurt; Brevo UE; Resend). Cifrado at-rest en Supabase; identificadores sensibles (DNI de donantes/afiliados) cifrados en columna (`ENCRYPTION_KEY`) y hash para control de límite anual.

---

## 1. Contacto ciudadano
- **Finalidad**: atender consultas enviadas por el formulario de contacto.
- **Base jurídica**: consentimiento (art. 6.1.a) / interés legítimo en responder.
- **Categorías**: nombre, apellidos, email, asunto, mensaje, IP.
- **Origen**: el propio interesado (`/api/contacto`).
- **Conservación**: hasta resolver la consulta + plazo de prescripción de reclamaciones.
- **Encargados**: Resend/Brevo (email transaccional), Netlify (hosting), Supabase (BBDD).

## 2. Newsletter (suscripción informativa)
- **Finalidad**: envío de novedades del partido.
- **Base jurídica**: **consentimiento con doble opt-in** (art. 6.1.a + LSSI art. 21).
- **Categorías**: email, idioma, timestamp + IP + texto aceptado (prueba de consentimiento en `consents`).
- **Conservación**: hasta baja (un clic en cada envío) o retirada del consentimiento.
- **Encargados**: Brevo (UE).

## 3. Marketing opt-in (en registro, contacto y crear propuesta)
- **Finalidad**: comunicaciones comerciales/informativas por email.
- **Base jurídica**: consentimiento **explícito y desmarcado por defecto** (registro en `consents`).
- **Categorías**: email, idioma, prueba de consentimiento (timestamp + IP + texto).
- **Conservación**: hasta baja. Alta en la lista Brevo del idioma.

## 4. Propuestas ciudadanas, votos y comentarios
- **Finalidad**: participación ciudadana (crear/apoyar propuestas, debate moderado).
- **Base jurídica**: consentimiento / ejecución de la relación con la persona usuaria registrada.
- **Categorías**: user_id, contenido de la propuesta/comentario, sentido del voto (1 persona = 1 voto), fecha.
- **Moderación**: comentarios y propuestas pasan por cola (`estado=pendiente`) antes de publicarse.
- **Conservación**: mientras la cuenta esté activa o hasta supresión.

## 5. Cuenta ciudadana / autenticación (incl. Google OAuth)
- **Finalidad**: identidad y área personal (mis propuestas, mis votos).
- **Base jurídica**: ejecución de la relación (art. 6.1.b) + consentimiento en OAuth.
- **Categorías**: email (verificado), nombre, identificador OAuth de Google.
- **Encargados**: Supabase Auth (UE); Google (OAuth) como proveedor de identidad.
- **Derechos**: acceso, rectificación, **supresión con borrado en cascada** de votos/comentarios.

## 6. Chat de comunidad
- **Finalidad**: conversación en la sección Comunidad para personas registradas.
- **Base jurídica**: consentimiento / ejecución de la relación.
- **Categorías**: user_id, mensaje, fecha (tabla `messages`). Moderable.
- **Conservación**: mientras la cuenta esté activa.

## 7. Afiliación (Fase 4 — pendiente de activación)
- **Finalidad**: alta y gestión de personas afiliadas; cobro de cuotas.
- **Base jurídica**: **art. 9.2.d (dato de afiliación política = categoría especial)** — consentimiento explícito separado (`aceptaPrivacidadArt9`) + estatutos; art. 6.1.b para la cuota.
- **Categorías**: nombre, apellidos, DNI/NIE (**cifrado**), dirección, email, datos de cuota. Nunca datos de tarjeta (PCI en Stripe hosted).
- **Encargados**: Stripe (pagos, SEPA), Supabase, Resend.
- **Conservación**: mientras dure la afiliación + obligaciones contables/legales.

## 8. Donaciones (Fase 4 — pendiente de activación) — LO 8/2007
- **Finalidad**: donaciones puntuales conformes a la Ley de financiación de partidos.
- **Base jurídica**: obligación legal (LO 8/2007) + consentimiento. **Prohibidas anónimas y de personas jurídicas**; límite 50.000 €/año/donante; identificación previa obligatoria.
- **Categorías**: nombre, apellidos, DNI/NIE (**cifrado**; hash para control de límite anual), email, importe, declaraciones responsables.
- **Encargados**: Stripe (Checkout hosted; solo se guardan `payment_intent`/`customer`), Supabase.
- **Conservación**: la exigida para la rendición al **Tribunal de Cuentas** (export contable por ejercicio).

## 9. Canal de denuncias (Ley 2/2023)
- **Finalidad**: canal interno de informaciones con confidencialidad/anonimato.
- **Base jurídica**: obligación legal (Ley 2/2023) + interés público.
- **Categorías**: contenido de la comunicación; identidad **opcional** (permite envío anónimo).
- **Acceso**: restringido al responsable designado; trazabilidad en `audit_log`.
- **Conservación**: la prevista por la Ley 2/2023.

## 10. Registro de actividad administrativa (`audit_log`)
- **Finalidad**: trazabilidad inmutable de acciones de moderación/publicación/pagos (quién, qué, cuándo).
- **Base jurídica**: interés legítimo + obligación de rendición de cuentas.
- **Acceso**: solo administración (protegida por contraseña + **2FA TOTP**, `ADMIN_TOTP_SECRET`).

---

## Medidas de seguridad (art. 32)
- Cifrado at-rest (Supabase) + cifrado de columna para DNI/NIE; hash para límite anual de donaciones.
- **RLS** (Row Level Security) por rol en todas las tablas; ver `docs/tests-rls.md`.
- **2FA TOTP** obligatorio en el panel de administración (ver `scripts/gen_totp_secret.mjs`).
- **Rate limiting** en todos los endpoints de escritura; anti-spam Turnstile en formularios sensibles.
- Firma verificada e idempotencia en el webhook de Stripe.
- Secretos solo en variables de entorno (nunca en el repositorio).

## Derechos de las personas interesadas
Acceso, rectificación, supresión, oposición, limitación y portabilidad. La supresión de cuenta borra en cascada votos y comentarios. Reclamación ante la **AEPD**. Notificación de brechas a la AEPD en **72 h** (runbook de incidentes — Fase 5).

## Pendiente de cierre (acción del responsable, no técnica)
- [ ] Nombrar responsable del canal de denuncias y (si procede) DPD.
- [ ] EIPD/DPIA para afiliados antes de activar Fase 4.
- [ ] Firmar contratos de encargado (art. 28) con Supabase, Brevo, Resend, Stripe, Netlify, Google.
- [ ] Publicar este RAT y enlazarlo desde la Política de Privacidad.

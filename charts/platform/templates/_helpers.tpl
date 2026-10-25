{{- define "platform.selector" -}}
app.kubernetes.io/name: {{ . }}
{{- end }}

{{- define "platform.labels" -}}
{{ include "platform.selector" . }}
app.kubernetes.io/part-of: platform
{{- end }}

{{- define "platform.host" -}}
{{ .sub }}.{{ .root.Values.domain }}
{{- end }}

{{- define "platform.url" -}}
{{ ternary "https" "http" .root.Values.ingress.tls }}://{{ include "platform.host" . }}
{{- end }}

{{/* Generated once, then read back from the cluster so upgrades keep the same value */}}
{{- define "platform.secretValue" -}}
{{- $data := (lookup "v1" "Secret" .root.Release.Namespace .name).data | default dict -}}
{{- index $data .key | default (.value | b64enc) -}}
{{- end }}

{{/* WordPress and WP-CLI read the same wp-config.php, so they need the same DB env */}}
{{- define "store.dbEnv" -}}
- name: WORDPRESS_DB_HOST
  value: mariadb
- name: WORDPRESS_DB_NAME
  value: wordpress
- name: WORDPRESS_DB_USER
  value: wordpress
- name: WORDPRESS_DB_PASSWORD
  valueFrom:
    secretKeyRef: { name: store-secrets, key: db-password }
{{- end }}

{{/* For our own images, which all run as the non-root "node" user */}}
{{- define "platform.securityContext" -}}
runAsNonRoot: true
runAsUser: 1000
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: [ALL]
{{- end }}

{{/*
An upstream MCP server: ClusterIP Service + Deployment, no Ingress.
The mcp-upstream label is what the NetworkPolicy uses to let only the gateway in.
*/}}
{{- define "platform.mcpServer" -}}
apiVersion: v1
kind: Service
metadata:
  name: {{ .name }}
  labels: {{- include "platform.labels" .name | nindent 4 }}
spec:
  selector: {{- include "platform.selector" .name | nindent 4 }}
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .name }}
  labels: {{- include "platform.labels" .name | nindent 4 }}
spec:
  replicas: 1
  selector:
    matchLabels: {{- include "platform.selector" .name | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "platform.labels" .name | nindent 8 }}
        mcp-upstream: "true"
    spec:
      containers:
        - name: {{ .name }}
          image: {{ .image }}
          {{- with .command }}
          command: {{ toJson . }}
          {{- end }}
          ports:
            - containerPort: 8080
          {{- with .env }}
          env: {{- . | nindent 12 }}
          {{- end }}
          readinessProbe:
            {{- toYaml .probe | nindent 12 }}
            periodSeconds: 10
          livenessProbe:
            {{- toYaml .probe | nindent 12 }}
            periodSeconds: 20
          resources: {{- toYaml .root.Values.mcpServerResources | nindent 12 }}
          securityContext: {{- include "platform.securityContext" . | nindent 12 }}
{{- end }}

{{- define "platform.storageClass" -}}
{{- with .Values.storageClass }}
storageClassName: {{ . }}
{{- end }}
{{- end }}

{{/* Ingress for one host; paths is a list of {path, service, port} */}}
{{- define "platform.ingress" -}}
{{- $host := include "platform.host" . -}}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ .name }}
  labels: {{- include "platform.labels" .name | nindent 4 }}
  {{- with .root.Values.ingress.annotations }}
  annotations: {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  ingressClassName: {{ .root.Values.ingress.className }}
  {{- if .root.Values.ingress.tls }}
  tls:
    - hosts: [{{ $host }}]
      secretName: {{ .name }}-tls
  {{- end }}
  rules:
    - host: {{ $host }}
      http:
        paths:
          {{- range .paths }}
          - path: {{ .path }}
            pathType: Prefix
            backend:
              service:
                name: {{ .service }}
                port:
                  number: {{ .port }}
          {{- end }}
{{- end }}

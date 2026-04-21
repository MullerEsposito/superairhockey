import React from 'react';
import styles from './HomePage.module.css';

export default function HomePage() {
  return (
    <main className={styles.shell}>
      <section className={styles.heroCard}>
        <p className={styles.eyebrow}>Super Air Hockey</p>
        <h1 className={styles.heroTitle}>TV em retrato, controle no celular, partida em segundos.</h1>
        <p className={styles.heroCopy}>
          O host gera a sala, os jogadores escolhem lado e o jogo roda em tempo real
          pela mesma infraestrutura Socket.IO que ja temos no backend.
        </p>
        <div className={styles.heroActions}>
          <a className={styles.primaryLink} href="/host">
            Abrir host
          </a>
          <a className={styles.secondaryLink} href="/controller">
            Abrir controle
          </a>
          <a className={styles.secondaryLink} href="/spectator">
            Abrir espectador
          </a>
        </div>
      </section>

      <section className={styles.infoGrid}>
        <article className={styles.infoCard}>
          <h2>Host</h2>
          <p>Cria a sala, desenha a mesa vertical e mostra nomes, placar e diagnostico.</p>
        </article>
        <article className={styles.infoCard}>
          <h2>Controller</h2>
          <p>Lista salas disponiveis, escolhe lado e usa sensores como se o aparelho estivesse em paisagem.</p>
        </article>
        <article className={styles.infoCard}>
          <h2>Backend</h2>
          <p>Express e Socket.IO seguem iguais, entao a migracao fica concentrada no frontend.</p>
        </article>
        <article className={styles.infoCard}>
          <h2>Spectator</h2>
          <p>Replica a mesa remotamente a partir dos snapshots enviados pelo host para a mesma sala.</p>
        </article>
      </section>
    </main>
  );
}
